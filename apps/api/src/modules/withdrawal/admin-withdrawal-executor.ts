import type { Prisma } from '@prisma/client';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import type {
  AdminWithdrawalAction,
  AdminWithdrawalCommand,
} from './admin-withdrawal-command.js';
import {
  markCommissionsWithdrawn,
  releaseCommissionsFromWithdrawal,
} from './withdrawal-commission-owner.js';
import {
  lockWithdrawal,
  transitionWithdrawal,
} from './withdrawal-owner.js';
import {
  recordPaidWithdrawalReward,
  restoreRejectedWithdrawalReward,
  validateReservedWithdrawalReward,
} from './withdrawal-reward-ledger-owner.js';

export type AdminWithdrawalCommandErrorCode =
  | 'ADMIN_WITHDRAWAL_NOT_FOUND'
  | 'ADMIN_WITHDRAWAL_FORBIDDEN'
  | 'ADMIN_WITHDRAWAL_VERSION_CONFLICT'
  | 'ADMIN_WITHDRAWAL_STATE_CONFLICT'
  | 'ADMIN_WITHDRAWAL_TAX_CONFLICT'
  | 'ADMIN_WITHDRAWAL_REWARD_CONFLICT'
  | 'ADMIN_WITHDRAWAL_IDEMPOTENCY_KEY_REUSED'
  | 'ADMIN_WITHDRAWAL_EXECUTION_FAILED';

export class AdminWithdrawalCommandError extends Error {
  readonly statusCode: number;
  readonly code: AdminWithdrawalCommandErrorCode;

  constructor(
    statusCode: number,
    code: AdminWithdrawalCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdminWithdrawalCommandError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

type WithdrawalEligibilitySnapshot = {
  id: string;
  version: number;
  status: string;
  tax_status: string;
  payable_amount_cents: number;
  invoice_required: boolean;
  invoice_status: string;
  commission_links: Array<{
    commission: {
      id: string;
      status: string;
      withdrawal_id: string | null;
      order_id?: string;
      order?: {
        pickup_store_id: string | null;
        community_id: string | null;
      };
    };
  }>;
};

export type AdminWithdrawalResult = {
  withdrawal_id: string;
  action: AdminWithdrawalAction;
  status: string;
  version: number;
  amount_cents: number;
  payable_amount_cents: number;
  commission_count: number;
  manual_reference: string | null;
  reviewed_at: string | null;
  processed_at: string | null;
  idempotent: boolean;
  withdrawal: {
    id: string;
    status: string;
    version: number;
  };
};

function conflict(
  code: AdminWithdrawalCommandErrorCode,
  message: string,
) {
  return new AdminWithdrawalCommandError(409, code, message);
}

export function assertAdminWithdrawalEligibility(
  action: AdminWithdrawalAction,
  withdrawal: WithdrawalEligibilitySnapshot,
  expectedVersion: number,
) {
  if (withdrawal.version !== expectedVersion) {
    throw conflict(
      'ADMIN_WITHDRAWAL_VERSION_CONFLICT',
      '提现状态已变化，请刷新后重试',
    );
  }
  const expectedStatus = action === 'mark-paid' ? 'approved' : 'pending';
  if (withdrawal.status !== expectedStatus) {
    throw conflict(
      'ADMIN_WITHDRAWAL_STATE_CONFLICT',
      action === 'mark-paid'
        ? '仅审核通过的提现申请可标记已处理'
        : '当前提现申请状态不可执行该操作',
    );
  }
  if (
    withdrawal.commission_links.length === 0 ||
    withdrawal.commission_links.some(
      (link) =>
        link.commission.status !== 'withdrawing' ||
        link.commission.withdrawal_id !== withdrawal.id,
    )
  ) {
    throw conflict(
      'ADMIN_WITHDRAWAL_REWARD_CONFLICT',
      '提现关联奖励状态已变化，请人工复核',
    );
  }
  if (
    action === 'mark-paid' &&
    (!['completed', 'calculated'].includes(withdrawal.tax_status) ||
      withdrawal.payable_amount_cents < 0)
  ) {
    throw conflict(
      'ADMIN_WITHDRAWAL_TAX_CONFLICT',
      '提现税务状态未完成或未计算，不能标记已处理',
    );
  }
  if (
    action === 'mark-paid' &&
    withdrawal.invoice_required &&
    withdrawal.invoice_status !== 'verified'
  ) {
    throw conflict(
      'ADMIN_WITHDRAWAL_TAX_CONFLICT',
      '发票状态未确认，不能标记已处理',
    );
  }
}

function commandError(
  statusCode: number,
  code: AdminWithdrawalCommandErrorCode,
  message: string,
) {
  return new AdminWithdrawalCommandError(statusCode, code, message);
}

function isResult(value: unknown): value is AdminWithdrawalResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.withdrawal_id === 'string' &&
    ['approve', 'reject', 'mark-paid'].includes(String(result.action)) &&
    typeof result.status === 'string' &&
    Number.isSafeInteger(result.version) &&
    Number.isSafeInteger(result.amount_cents) &&
    Number.isSafeInteger(result.payable_amount_cents)
  );
}

function isUniqueConflict(error: unknown) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function withdrawalEventSnapshot(target: {
  id: string;
  leader_user_id: string;
  status: string;
  version: number;
  amount_cents: number;
  payable_amount_cents: number;
  admin_remark: string | null;
  manual_reference: string | null;
  reviewed_at: Date | null;
  processed_at: Date | null;
}) {
  return {
    id: target.id,
    leader_user_id: target.leader_user_id,
    status: target.status,
    version: target.version,
    amount_cents: target.amount_cents,
    payable_amount_cents: target.payable_amount_cents,
    admin_remark: target.admin_remark,
    manual_reference: target.manual_reference,
    reviewed_at: target.reviewed_at?.toISOString() ?? null,
    processed_at: target.processed_at?.toISOString() ?? null,
  };
}

export async function executeAdminWithdrawalCommand(input: {
  withdrawal_id: string;
  action: AdminWithdrawalAction;
  command: AdminWithdrawalCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminWithdrawalResult> {
  const [
    { prisma },
    { canAccessOrderDataScope },
    { buildAdminWithdrawalRequestHash },
    {
      recordAdminAudit,
      recordBusinessEvent,
      recordOrderTimeline,
    },
  ] = await Promise.all([
    import('../../db.js'),
    import('../admin-access/admin-access-control.js'),
    import('./admin-withdrawal-command.js'),
    import('../audit/audit-service.js'),
  ]);

  const loadTarget = (client: Prisma.TransactionClient | typeof prisma) =>
    client.withdrawal.findUnique({
      where: { id: input.withdrawal_id },
      include: {
        commission_links: {
          include: {
            commission: {
              include: { order: true },
            },
          },
        },
      },
    });
  const assertScope = (
    target: NonNullable<Awaited<ReturnType<typeof loadTarget>>>,
  ) => {
    if (
      !input.context.is_super_admin &&
      (target.commission_links.length === 0 ||
        target.commission_links.some(
          (link) =>
            !canAccessOrderDataScope(input.context, link.commission.order),
        ))
    ) {
      throw commandError(
        403,
        'ADMIN_WITHDRAWAL_FORBIDDEN',
        '当前管理员无权操作该提现申请',
      );
    }
  };

  const initial = await loadTarget(prisma);
  if (!initial) {
    throw commandError(
      404,
      'ADMIN_WITHDRAWAL_NOT_FOUND',
      '提现申请不存在',
    );
  }
  assertScope(initial);
  const requestHash = buildAdminWithdrawalRequestHash({
    withdrawal_id: initial.id,
    action: input.action,
    expected_version: input.command.expected_version,
    admin_remark: input.command.admin_remark,
    manual_reference: input.command.manual_reference ?? null,
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
      throw commandError(
        500,
        'ADMIN_WITHDRAWAL_EXECUTION_FAILED',
        '提现操作执行失败',
      );
    }
    const current = await loadTarget(prisma);
    if (!current) {
      throw commandError(
        404,
        'ADMIN_WITHDRAWAL_NOT_FOUND',
        '提现申请不存在',
      );
    }
    assertScope(current);
    if (receipt.request_hash !== requestHash) {
      throw commandError(
        409,
        'ADMIN_WITHDRAWAL_IDEMPOTENCY_KEY_REUSED',
        '幂等键已被其他命令使用',
      );
    }
    if (
      receipt.completed_at === null ||
      receipt.response_http_status !== 200 ||
      !isResult(receipt.response_data)
    ) {
      throw commandError(
        500,
        'ADMIN_WITHDRAWAL_EXECUTION_FAILED',
        '提现操作执行失败',
      );
    }
    return { ...receipt.response_data, idempotent: true };
  };

  const existingReceipt = await prisma.adminCommandReceipt.findUnique({
    where: { admin_user_id_idempotency_key: receiptKey },
    select: { id: true },
  });
  if (existingReceipt) return replay();
  assertAdminWithdrawalEligibility(
    input.action,
    initial,
    input.command.expected_version,
  );

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.adminCommandReceipt.create({
        data: {
          ...receiptKey,
          operation: `admin.withdrawal.${input.action}.v1`,
          target_id: initial.id,
          request_hash: requestHash,
        },
      });
      const before = await lockWithdrawal(tx, input.withdrawal_id);
      if (!before) {
        throw commandError(
          404,
          'ADMIN_WITHDRAWAL_NOT_FOUND',
          '提现申请不存在',
        );
      }
      assertScope(before);
      assertAdminWithdrawalEligibility(
        input.action,
        before,
        input.command.expected_version,
      );
      const linkedAmount = before.commission_links.reduce(
        (total, link) => total + link.amount_cents,
        0,
      );
      if (linkedAmount !== before.amount_cents) {
        throw conflict(
          'ADMIN_WITHDRAWAL_REWARD_CONFLICT',
          '提现关联奖励金额不一致，请人工复核',
        );
      }
      if (input.action === 'reject') {
        try {
          await validateReservedWithdrawalReward(tx, {
            withdrawal_id: before.id,
            amount_cents: before.amount_cents,
          });
        } catch {
          throw conflict(
            'ADMIN_WITHDRAWAL_REWARD_CONFLICT',
            '提现预留奖励账本不一致，请人工复核',
          );
        }
      }
      let updated;
      try {
        updated = await transitionWithdrawal(tx, {
          withdrawal_id: before.id,
          expected_version: input.command.expected_version,
          action: input.action,
          admin_user_id: input.context.admin_user_id,
          admin_remark: input.command.admin_remark,
          manual_reference: input.command.manual_reference,
        });
      } catch {
        throw conflict(
          'ADMIN_WITHDRAWAL_VERSION_CONFLICT',
          '提现状态已变化，请刷新后重试',
        );
      }

      const commissionIds = before.commission_links.map(
        (link) => link.commission.id,
      );
      const commissionIdsByOrder = new Map<string, string[]>();
      for (const link of before.commission_links) {
        const orderCommissionIds =
          commissionIdsByOrder.get(link.commission.order_id) ?? [];
        orderCommissionIds.push(link.commission.id);
        commissionIdsByOrder.set(
          link.commission.order_id,
          orderCommissionIds,
        );
      }
      const orderIds = Array.from(commissionIdsByOrder.keys());
      if (input.action !== 'approve') {
        try {
          if (input.action === 'reject') {
            await releaseCommissionsFromWithdrawal(tx, {
              withdrawal_id: before.id,
              commission_ids: commissionIds,
            });
            await restoreRejectedWithdrawalReward(tx, {
              leader_user_id: before.leader_user_id,
              withdrawal_id: before.id,
              amount_cents: before.amount_cents,
            });
          } else {
            await markCommissionsWithdrawn(tx, {
              withdrawal_id: before.id,
              commission_ids: commissionIds,
            });
            await recordPaidWithdrawalReward(tx, {
              leader_user_id: before.leader_user_id,
              withdrawal_id: before.id,
              amount_cents: before.amount_cents,
            });
          }
        } catch {
          throw conflict(
            'ADMIN_WITHDRAWAL_REWARD_CONFLICT',
            '提现关联奖励状态已变化，请人工复核',
          );
        }
      }
      const eventType =
        input.action === 'approve'
          ? 'withdrawal_approved'
          : input.action === 'reject'
            ? 'withdrawal_rejected'
            : 'withdrawal_mark_paid';
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: eventType,
        target_type: 'Withdrawal',
        target_id: before.id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          expected_version: input.command.expected_version,
          version: updated.version,
          idempotency_key: input.command.idempotency_key,
          commission_ids: commissionIds,
          order_ids: orderIds,
        },
      });
      const beforeSnapshot = withdrawalEventSnapshot(before);
      const afterSnapshot = withdrawalEventSnapshot(updated);
      await recordBusinessEvent(tx, {
        event_type: eventType,
        event_source: 'admin-withdrawal-command',
        withdrawal_id: before.id,
        leader_user_id: before.leader_user_id,
        before_snapshot: beforeSnapshot,
        after_snapshot: afterSnapshot,
        payload: {
          idempotency_key: input.command.idempotency_key,
          commission_ids: commissionIds,
          order_ids: orderIds,
        },
        message: input.command.admin_remark,
      });
      for (const orderId of orderIds) {
        const orderCommissionIds = commissionIdsByOrder.get(orderId) ?? [];
        await recordBusinessEvent(tx, {
          event_type: eventType,
          event_source: 'admin-withdrawal-command',
          order_id: orderId,
          withdrawal_id: before.id,
          leader_user_id: before.leader_user_id,
          before_snapshot: beforeSnapshot,
          after_snapshot: afterSnapshot,
          payload: {
            idempotency_key: input.command.idempotency_key,
            order_id: orderId,
            commission_ids: orderCommissionIds,
          },
          message: input.command.admin_remark,
        });
        await recordOrderTimeline(tx, {
          order_id: orderId,
          event_type: eventType,
          title: '开团服务奖励提现状态已更新',
          message: input.command.admin_remark,
          from_status: before.status,
          to_status: updated.status,
          actor_type: 'admin',
          actor_user_id: input.context.admin_user_id,
          payload: {
            withdrawal_id: before.id,
            version: updated.version,
          },
        });
      }
      const result: AdminWithdrawalResult = {
        withdrawal_id: updated.id,
        action: input.action,
        status: updated.status,
        version: updated.version,
        amount_cents: updated.amount_cents,
        payable_amount_cents: updated.payable_amount_cents,
        commission_count: commissionIds.length,
        manual_reference: updated.manual_reference,
        reviewed_at: updated.reviewed_at?.toISOString() ?? null,
        processed_at: updated.processed_at?.toISOString() ?? null,
        idempotent: false,
        withdrawal: {
          id: updated.id,
          status: updated.status,
          version: updated.version,
        },
      };
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: eventType.toUpperCase(),
          response_data: result as Prisma.InputJsonValue,
          completed_at: new Date(),
        },
      });
      return result;
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    return replay();
  }
}
