import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import { canAccessOrderDataScope } from '../admin-access/admin-access-control.js';
import {
  recordAdminAudit,
  recordBusinessEvent,
  recordOrderTimeline,
} from '../audit/audit-service.js';
import { reviewWithdrawalTax } from '../tax-record/withdrawal-tax-owner.js';
import {
  type AdminWithdrawalTaxReviewCommand,
  buildAdminWithdrawalTaxReviewRequestHash,
} from './admin-withdrawal-tax-review-command.js';
import {
  applyWithdrawalTaxPatch,
  lockWithdrawal,
} from './withdrawal-owner.js';

const OPERATION = 'admin.withdrawal.tax-review.v1';
const SUCCESS_CODE = 'ADMIN_WITHDRAWAL_TAX_REVIEWED';

export class AdminWithdrawalTaxReviewError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code:
      | 'ADMIN_WITHDRAWAL_NOT_FOUND'
      | 'ADMIN_WITHDRAWAL_FORBIDDEN'
      | 'ADMIN_WITHDRAWAL_TAX_REVIEW_CONFLICT'
      | 'ADMIN_WITHDRAWAL_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_WITHDRAWAL_TAX_REVIEW_INVALID'
      | 'ADMIN_WITHDRAWAL_TAX_REVIEW_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminWithdrawalTaxReviewError';
  }
}

function isTaxReviewResult(value: unknown): value is {
  withdrawal: { id: string; version: number };
  tax_record: { id: string; source_type: string; source_id: string };
  idempotent: boolean;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const withdrawal = result.withdrawal as Record<string, unknown> | undefined;
  const taxRecord = result.tax_record as Record<string, unknown> | undefined;
  return (
    !!withdrawal &&
    typeof withdrawal.id === 'string' &&
    Number.isSafeInteger(withdrawal.version) &&
    !!taxRecord &&
    typeof taxRecord.id === 'string' &&
    taxRecord.source_type === 'withdrawal' &&
    taxRecord.source_id === withdrawal.id
  );
}

export function assertTaxReviewReceiptReplay(
  receipt: {
    operation: string;
    target_id: string;
    request_hash: string;
    completed_at: Date | null;
    response_http_status: number | null;
    response_code: string | null;
    response_data: unknown;
  },
  expected: { withdrawal_id: string; request_hash: string },
) {
  if (receipt.request_hash !== expected.request_hash) {
    throw new AdminWithdrawalTaxReviewError(
      409,
      'ADMIN_WITHDRAWAL_IDEMPOTENCY_KEY_REUSED',
      '幂等键已被其他命令使用',
    );
  }
  if (
    receipt.operation !== OPERATION ||
    receipt.target_id !== expected.withdrawal_id ||
    receipt.completed_at === null ||
    receipt.response_http_status !== 200 ||
    receipt.response_code !== SUCCESS_CODE ||
    !isTaxReviewResult(receipt.response_data)
  ) {
    throw new AdminWithdrawalTaxReviewError(
      500,
      'ADMIN_WITHDRAWAL_TAX_REVIEW_FAILED',
      '提现税务复核失败',
    );
  }
  return { ...receipt.response_data, idempotent: true };
}

function assertScope(target: any, context: AdminAccessContext) {
  if (
    !context.is_super_admin &&
    (target.commission_links.length === 0 ||
      target.commission_links.some(
        (link: any) =>
          !canAccessOrderDataScope(context, link.commission.order),
      ))
  ) {
    throw new AdminWithdrawalTaxReviewError(
      403,
      'ADMIN_WITHDRAWAL_FORBIDDEN',
      '当前管理员无权操作该提现申请',
    );
  }
}

function isPrismaCode(error: unknown, code: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

export async function executeAdminWithdrawalTaxReviewCommand(input: {
  withdrawal_id: string;
  command: AdminWithdrawalTaxReviewCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}) {
  const requestHash = buildAdminWithdrawalTaxReviewRequestHash({
    withdrawal_id: input.withdrawal_id,
    command: input.command,
  });
  const receiptKey = {
    admin_user_id: input.context.admin_user_id,
    idempotency_key: input.command.idempotency_key,
  };
  const replay = async () => {
    const receipt = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: receiptKey },
    });
    if (!receipt) {
      throw new AdminWithdrawalTaxReviewError(
        500,
        'ADMIN_WITHDRAWAL_TAX_REVIEW_FAILED',
        '提现税务复核失败',
      );
    }
    return assertTaxReviewReceiptReplay(receipt, {
      withdrawal_id: input.withdrawal_id,
      request_hash: requestHash,
    });
  };
  const existingReceipt = await prisma.adminCommandReceipt.findUnique({
    where: { admin_user_id_idempotency_key: receiptKey },
    select: { id: true },
  });
  if (existingReceipt) return replay();

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.adminCommandReceipt.create({
        data: {
          ...receiptKey,
          operation: OPERATION,
          target_id: input.withdrawal_id,
          request_hash: requestHash,
        },
      });
      const before = await lockWithdrawal(tx, input.withdrawal_id);
      if (!before) {
        throw new AdminWithdrawalTaxReviewError(
          404,
          'ADMIN_WITHDRAWAL_NOT_FOUND',
          '提现申请不存在',
        );
      }
      assertScope(before, input.context);
      if (
        !['pending', 'approved'].includes(before.status) ||
        before.version !== input.command.expected_version
      ) {
        throw new AdminWithdrawalTaxReviewError(
          409,
          'ADMIN_WITHDRAWAL_TAX_REVIEW_CONFLICT',
          '提现税务状态已变化，请刷新后重试',
        );
      }
      const reviewed = await reviewWithdrawalTax(tx, {
        withdrawal: before,
        command: input.command,
        receipt_id: receipt.id,
      });
      const updated = await applyWithdrawalTaxPatch(tx, {
        withdrawal_id: before.id,
        expected_version: input.command.expected_version,
        reviewed_by_admin_id: input.context.admin_user_id,
        patch: reviewed.withdrawal_patch,
      });
      const commissionIds = before.commission_links.map(
        (link) => link.commission_id,
      );
      const orderIds = [
        ...new Set(
          before.commission_links.map(
            (link) => link.commission.order_id,
          ),
        ),
      ];
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: 'withdrawal_tax_reviewed',
        target_type: 'Withdrawal',
        target_id: before.id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          receipt_id: receipt.id,
          idempotency_key: input.command.idempotency_key,
          before_version: before.version,
          after_version: updated.version,
          commission_ids: commissionIds,
        },
      });
      const eventPayload = {
        receipt_id: receipt.id,
        withdrawal_id: before.id,
        tax_record_id: reviewed.tax_record.id,
        commission_ids: commissionIds,
        order_ids: orderIds,
        before_version: before.version,
        after_version: updated.version,
      };
      await recordBusinessEvent(tx, {
        event_type: 'withdrawal_tax_reviewed',
        event_source: 'admin-withdrawal-tax-review-executor',
        withdrawal_id: before.id,
        leader_user_id: before.leader_user_id,
        before_snapshot: before,
        after_snapshot: updated,
        payload: eventPayload,
      });
      for (const orderId of orderIds) {
        await recordBusinessEvent(tx, {
          event_type: 'withdrawal_tax_reviewed',
          event_source: 'admin-withdrawal-tax-review-executor',
          order_id: orderId,
          withdrawal_id: before.id,
          leader_user_id: before.leader_user_id,
          before_snapshot: before,
          after_snapshot: updated,
          payload: eventPayload,
        });
        await recordOrderTimeline(tx, {
          order_id: orderId,
          event_type: 'withdrawal_tax_reviewed',
          title: '开团服务奖励提现税务状态已更新',
          actor_type: 'admin',
          actor_user_id: input.context.admin_user_id,
          payload: {
            withdrawal_id: before.id,
            tax_record_id: reviewed.tax_record.id,
            tax_status: reviewed.withdrawal_patch.tax_status,
          },
        });
      }
      const response = JSON.parse(
        JSON.stringify({
          withdrawal: updated,
          tax_record: reviewed.tax_record,
          idempotent: false,
        }),
      );
      if (!isTaxReviewResult(response)) {
        throw new Error('Invalid tax review response');
      }
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: SUCCESS_CODE,
          response_data: response as Prisma.InputJsonValue,
          completed_at: new Date(),
        },
      });
      return response;
    });
  } catch (error) {
    if (isPrismaCode(error, 'P2002')) return replay();
    if (isPrismaCode(error, 'P2034')) {
      throw new AdminWithdrawalTaxReviewError(
        409,
        'ADMIN_WITHDRAWAL_TAX_REVIEW_CONFLICT',
        '提现税务状态已变化，请刷新后重试',
      );
    }
    if (error instanceof AdminWithdrawalTaxReviewError) throw error;
    if (
      error instanceof Error &&
      [
        '应税金额不能超过提现金额',
        '税务金额不能超过应税金额',
      ].includes(error.message)
    ) {
      throw new AdminWithdrawalTaxReviewError(
        400,
        'ADMIN_WITHDRAWAL_TAX_REVIEW_INVALID',
        error.message,
      );
    }
    if (
      error instanceof Error &&
      error.message === '提现状态已变化，请刷新后重试'
    ) {
      throw new AdminWithdrawalTaxReviewError(
        409,
        'ADMIN_WITHDRAWAL_TAX_REVIEW_CONFLICT',
        error.message,
      );
    }
    throw new AdminWithdrawalTaxReviewError(
      500,
      'ADMIN_WITHDRAWAL_TAX_REVIEW_FAILED',
      '提现税务复核失败',
    );
  }
}
