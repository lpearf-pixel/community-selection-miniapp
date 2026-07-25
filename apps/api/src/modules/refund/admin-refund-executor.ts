import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  type AdminAccessContext,
  canAccessOrderDataScope,
} from '../admin-access/admin-access-control.js';
import { recordAfterSaleLog } from '../after-sale/after-sale-service.js';
import {
  recordAdminAudit,
  recordBusinessEvent,
  recordOrderTimeline,
} from '../audit/audit-service.js';
import {
  applyMockRefundInTransaction,
  RefundOrderVersionConflictError,
} from '../../services/refund-service.js';
import {
  type AdminRefundCommand,
  type AdminRefundResult,
  buildAdminRefundRequestHash,
} from './admin-refund-command.js';

const OPERATION = 'admin.after_sale.refund.execute.v1';
const SUCCESS_CODE = 'ADMIN_REFUND_EXECUTED';

export class AdminRefundCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_AFTER_SALE_NOT_FOUND'
      | 'ADMIN_FORBIDDEN'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_ORDER_VERSION_CONFLICT'
      | 'ADMIN_REFUND_STATE_CONFLICT'
      | 'ADMIN_REFUND_AMOUNT_CONFLICT'
      | 'ADMIN_REFUND_PROVIDER_UNAVAILABLE'
      | 'ADMIN_REFUND_EXECUTION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AdminRefundCommandError';
  }
}

function commandError(
  statusCode: number,
  code: AdminRefundCommandError['code'],
  message: string,
) {
  return new AdminRefundCommandError(statusCode, code, message);
}

type RefundEligibilitySnapshot = {
  status: string;
  resolution_type: string | null;
  approved_refund_cents: number | null;
  approved_product_refund_cents: number | null;
  approved_delivery_refund_cents: number | null;
  order: {
    version: number;
    pay_amount_cents: number;
    refund_amount_cents: number;
    product_amount_cents: number | null;
    product_refund_amount_cents: number;
    delivery_fee_cents: number;
    delivery_refund_amount_cents: number;
  };
};

function approvedSplit(item: RefundEligibilitySnapshot) {
  return {
    approved_refund_cents: item.approved_refund_cents ?? 0,
    approved_product_refund_cents:
      item.approved_product_refund_cents ?? 0,
    approved_delivery_refund_cents:
      item.approved_delivery_refund_cents ?? 0,
  };
}

export function assertAdminRefundEligibility(
  item: RefundEligibilitySnapshot,
  expectedVersion: number,
) {
  if (
    item.status !== 'approved' ||
    !['refund', 'partial_refund'].includes(item.resolution_type ?? '')
  ) {
    throw commandError(
      409,
      'ADMIN_REFUND_STATE_CONFLICT',
      '当前售后状态不可执行退款',
    );
  }
  if (item.order.version !== expectedVersion) {
    throw commandError(
      409,
      'ADMIN_ORDER_VERSION_CONFLICT',
      '订单已被其他操作更新，请刷新后重试',
    );
  }

  const split = approvedSplit(item);
  const total = split.approved_refund_cents;
  const product = split.approved_product_refund_cents;
  const delivery = split.approved_delivery_refund_cents;
  const productPaid = item.order.product_amount_cents ?? item.order.pay_amount_cents;
  const productRemaining =
    productPaid - item.order.product_refund_amount_cents;
  const deliveryRemaining =
    item.order.delivery_fee_cents - item.order.delivery_refund_amount_cents;
  const totalRemaining =
    item.order.pay_amount_cents - item.order.refund_amount_cents;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(product) ||
    !Number.isSafeInteger(delivery) ||
    total <= 0 ||
    product < 0 ||
    delivery < 0 ||
    product + delivery !== total ||
    product > productRemaining ||
    delivery > deliveryRemaining ||
    total > totalRemaining
  ) {
    throw commandError(
      409,
      'ADMIN_REFUND_AMOUNT_CONFLICT',
      '审核退款金额与当前可退金额冲突',
    );
  }
  return {
    approved_refund_cents: total,
    approved_product_refund_cents: product,
    approved_delivery_refund_cents: delivery,
  };
}

function assertScope(
  context: AdminAccessContext,
  order: { pickup_store_id: string | null; community_id: string | null },
) {
  if (!canAccessOrderDataScope(context, order)) {
    throw commandError(403, 'ADMIN_FORBIDDEN', '当前管理员无权操作该订单');
  }
}

function isResult(value: unknown): value is AdminRefundResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.after_sale_case_id === 'string' &&
    typeof item.order_id === 'string' &&
    typeof item.refund_id === 'string' &&
    item.refund_status === 'success' &&
    item.execution_mode === 'mock' &&
    Number.isSafeInteger(item.version)
  );
}

function isUniqueConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function loadTarget(afterSaleCaseId: string) {
  return prisma.afterSaleCase.findUnique({
    where: { id: afterSaleCaseId },
    include: { order: true },
  });
}

export async function executeAdminRefundCommand(input: {
  after_sale_case_id: string;
  command: AdminRefundCommand;
  context: AdminAccessContext;
  admin_meta: {
    ip_address?: string | null;
    user_agent?: string | null;
  };
}): Promise<AdminRefundResult> {
  const target = await loadTarget(input.after_sale_case_id);
  if (!target) {
    throw commandError(404, 'ADMIN_AFTER_SALE_NOT_FOUND', '售后工单不存在');
  }
  assertScope(input.context, target.order);
  const approved = approvedSplit(target);
  const requestHash = buildAdminRefundRequestHash({
    after_sale_case_id: target.id,
    order_id: target.order_id,
    expected_version: input.command.expected_version,
    admin_remark: input.command.admin_remark,
    ...approved,
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
      throw commandError(500, 'ADMIN_REFUND_EXECUTION_FAILED', '退款执行失败');
    }
    const current = await loadTarget(input.after_sale_case_id);
    if (!current) {
      throw commandError(404, 'ADMIN_AFTER_SALE_NOT_FOUND', '售后工单不存在');
    }
    assertScope(input.context, current.order);
    if (receipt.request_hash !== requestHash) {
      throw commandError(
        409,
        'ADMIN_IDEMPOTENCY_KEY_REUSED',
        '幂等键已被其他命令使用',
      );
    }
    if (
      receipt.completed_at === null ||
      receipt.response_http_status !== 200 ||
      receipt.response_code !== SUCCESS_CODE ||
      !isResult(receipt.response_data)
    ) {
      throw commandError(500, 'ADMIN_REFUND_EXECUTION_FAILED', '退款执行失败');
    }
    return receipt.response_data;
  };

  const existingReceipt = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: receiptKey },
      select: { id: true },
    });
  if (existingReceipt) {
    return replay();
  }
  assertAdminRefundEligibility(target, input.command.expected_version);
  if (process.env.MOCK_WECHAT_PAY !== 'true') {
    throw commandError(
      503,
      'ADMIN_REFUND_PROVIDER_UNAVAILABLE',
      '真实退款提供方尚未接入',
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.adminCommandReceipt.create({
        data: {
          ...receiptKey,
          operation: OPERATION,
          target_id: target.id,
          request_hash: requestHash,
        },
      });
      const before = await tx.afterSaleCase.findUnique({
        where: { id: target.id },
        include: { order: true },
      });
      if (!before) {
        throw commandError(404, 'ADMIN_AFTER_SALE_NOT_FOUND', '售后工单不存在');
      }
      assertScope(input.context, before.order);
      const currentApproved = assertAdminRefundEligibility(
        before,
        input.command.expected_version,
      );
      const changed = await tx.afterSaleCase.updateMany({
        where: { id: before.id, status: 'approved' },
        data: {
          status: 'processing',
          resolved_by_admin_id: input.context.admin_user_id,
          admin_note: input.command.admin_remark,
        },
      });
      if (changed.count !== 1) {
        throw commandError(
          409,
          'ADMIN_REFUND_STATE_CONFLICT',
          '当前售后状态不可执行退款',
        );
      }
      const refund = await applyMockRefundInTransaction(
        tx,
        {
          order_id: before.order_id,
          refund_amount_cents: currentApproved.approved_refund_cents,
          product_refund_amount_cents:
            currentApproved.approved_product_refund_cents,
          delivery_refund_amount_cents:
            currentApproved.approved_delivery_refund_cents,
          reason: `售后执行：${before.reason}`,
          client_refund_id: `admin-refund-${receipt.id}`,
        },
        { expected_order_version: input.command.expected_version },
      );
      const afterSale = await tx.afterSaleCase.update({
        where: { id: before.id },
        data: {
          status: 'resolved',
          refund_id: refund.id,
          resolved_at: new Date(),
        },
      });
      const afterOrder = await tx.order.findUniqueOrThrow({
        where: { id: before.order_id },
      });
      await recordAfterSaleLog(
        tx,
        afterSale,
        'after_sale_refund_executed',
        { actor_type: 'admin', actor_id: input.context.admin_user_id },
        input.command.admin_remark,
        { refund_id: refund.id, idempotency_key: input.command.idempotency_key },
      );
      await recordBusinessEvent(tx, {
        event_type: 'admin_refund_executed',
        event_source: 'admin-refund-command',
        order_id: before.order_id,
        refund_id: refund.id,
        idempotency_key: input.command.idempotency_key,
        before_snapshot: before,
        after_snapshot: afterSale,
      });
      await recordOrderTimeline(tx, {
        order_id: before.order_id,
        event_type: 'admin_refund_executed',
        title: '后台已执行退款',
        message: input.command.admin_remark,
        from_status: before.order.order_status,
        to_status: afterOrder.order_status,
        actor_type: 'admin',
        actor_user_id: input.context.admin_user_id,
        payload: { after_sale_case_id: before.id, refund_id: refund.id },
      });
      await recordAdminAudit(tx, {
        admin_user_id: input.context.admin_user_id,
        action: 'after_sale_refund_executed',
        target_type: 'AfterSaleCase',
        target_id: before.id,
        ip_address: input.admin_meta.ip_address ?? null,
        user_agent: input.admin_meta.user_agent ?? null,
        payload: {
          order_id: before.order_id,
          refund_id: refund.id,
          expected_version: input.command.expected_version,
          version: afterOrder.version,
          ...currentApproved,
        },
      });
      const result: AdminRefundResult = {
        after_sale_case_id: before.id,
        order_id: before.order_id,
        refund_id: refund.id,
        refund_status: 'success',
        refund_amount_cents: refund.refund_amount_cents,
        product_refund_amount_cents: refund.product_refund_amount_cents,
        delivery_refund_amount_cents: refund.delivery_refund_amount_cents,
        remaining_refundable_amount_cents:
          afterOrder.pay_amount_cents - afterOrder.refund_amount_cents,
        order_status: afterOrder.order_status,
        version: afterOrder.version,
        execution_mode: 'mock',
      };
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: SUCCESS_CODE,
          response_data: result as Prisma.InputJsonValue,
          completed_at: new Date(),
        },
      });
      return result;
    });
  } catch (error) {
    if (error instanceof RefundOrderVersionConflictError) {
      throw commandError(
        409,
        'ADMIN_ORDER_VERSION_CONFLICT',
        '订单已被其他操作更新，请刷新后重试',
      );
    }
    if (!isUniqueConflict(error)) throw error;
    return replay();
  }
}
