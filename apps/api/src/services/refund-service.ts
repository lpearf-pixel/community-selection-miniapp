import type { Order, Prisma, Refund } from '@prisma/client';
import { prisma } from '../db.js';
import {
  confirmRefundSuccess,
  createPendingRefund,
  findRefundByClientKey,
  getRefundRecord,
  setRefundStockRestored,
  type RefundNotifyInfo,
} from '../modules/refund/refund-record-service.js';
import {
  lockRefundableOrder,
  projectRefundSuccess,
  recordRefundOrderEffects,
  RefundOrderVersionConflictError,
} from '../modules/order/order-refund-service.js';
import { restoreInventoryForRefund } from '../modules/inventory/inventory-order-service.js';
import { returnOrderCreditAfterFullRefund } from '../modules/consumer-credit/order-refund-credit-service.js';
import { syncCommissionAfterRefund } from './commission-service.js';
import {
  recordBusinessEvent,
  safeRecordBusinessEvent,
} from './logging-service.js';

export { RefundOrderVersionConflictError };

export type RefundInput = {
  order_id: string;
  refund_amount_cents: number;
  product_refund_amount_cents?: number;
  delivery_refund_amount_cents?: number;
  reason: string;
  client_refund_id?: string;
};

type NotifyInfo = RefundNotifyInfo;

const autoRestoreStockStatuses = [
  'paid',
  'grouped',
  'preparing',
  'ready',
  'refunding',
];
const stockRestorePolicy = 'full_refund_auto_restore_before_fulfillment';

export function getRefundableAmount(order: {
  pay_amount_cents: number;
  refund_amount_cents: number;
}) {
  return order.pay_amount_cents - order.refund_amount_cents;
}

export function buildOutRefundNo(
  order: { order_no: string },
  clientRefundId?: string,
) {
  const suffix = clientRefundId
    ? clientRefundId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
    : `${Date.now()}`;
  return `RF${order.order_no}${suffix}`;
}

function ensureNonNegativeInteger(value: unknown, message: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(message);
  return parsed;
}

function allocateRefundSplit(
  order: Pick<
    Order,
    | 'product_amount_cents'
    | 'total_amount_cents'
    | 'delivery_fee_cents'
    | 'product_refund_amount_cents'
    | 'delivery_refund_amount_cents'
  >,
  input: RefundInput,
) {
  const productPaid = order.product_amount_cents ?? order.total_amount_cents;
  const deliveryPaid = order.delivery_fee_cents ?? 0;
  const productRemaining = Math.max(
    0,
    productPaid - order.product_refund_amount_cents,
  );
  const deliveryRemaining = Math.max(
    0,
    deliveryPaid - order.delivery_refund_amount_cents,
  );
  const explicit = input.product_refund_amount_cents != null
    || input.delivery_refund_amount_cents != null;
  if (explicit) {
    const productRefund = ensureNonNegativeInteger(
      input.product_refund_amount_cents ?? 0,
      '商品退款金额不能小于 0',
    );
    const deliveryRefund = ensureNonNegativeInteger(
      input.delivery_refund_amount_cents ?? 0,
      '配送费退款金额不能小于 0',
    );
    if (productRefund + deliveryRefund !== input.refund_amount_cents) {
      throw new Error('商品退款金额与配送费退款金额之和必须等于总退款金额');
    }
    if (productRefund > productRemaining) {
      throw new Error('商品退款金额超过商品可退金额');
    }
    if (deliveryRefund > deliveryRemaining) {
      throw new Error('配送费退款金额超过配送费可退金额');
    }
    return { productRefund, deliveryRefund };
  }
  const productRefund = Math.min(
    input.refund_amount_cents,
    productRemaining,
  );
  const deliveryRefund = input.refund_amount_cents - productRefund;
  if (deliveryRefund > deliveryRemaining) {
    throw new Error('退款金额超过订单实付金额');
  }
  return { productRefund, deliveryRefund };
}

function validateRefundInput(order: Order, input: RefundInput) {
  if (
    order.pay_status !== 'paid'
    || order.order_status === 'unpaid'
    || order.order_status === 'closed'
  ) {
    throw new Error('未支付订单不能退款');
  }
  if (
    ![
      'paid',
      'grouped',
      'preparing',
      'ready',
      'picked',
      'delivered',
      'completed',
      'refunding',
    ].includes(order.order_status)
  ) {
    throw new Error('当前订单状态不可退款');
  }
  if (order.refund_amount_cents >= order.pay_amount_cents) {
    throw new Error('订单已全额退款');
  }
  if (
    !Number.isInteger(input.refund_amount_cents)
    || input.refund_amount_cents <= 0
  ) {
    throw new Error('退款金额必须大于 0');
  }
  if (input.refund_amount_cents > getRefundableAmount(order)) {
    throw new Error('退款金额超过订单实付金额');
  }
  return allocateRefundSplit(order, input);
}

export async function validateRefundRequest(
  tx: Prisma.TransactionClient,
  input: RefundInput,
) {
  const order = await lockRefundableOrder(tx, input.order_id);
  const refundSplit = validateRefundInput(order, input);
  return { ...order, refundSplit };
}

async function projectFirstRefundSuccess(
  tx: Prisma.TransactionClient,
  input: {
    beforeOrder: Order;
    refund: Refund;
    expected_order_version?: number;
  },
): Promise<Refund> {
  const projection = await projectRefundSuccess(tx, {
    order: input.beforeOrder,
    refund: input.refund,
    expected_order_version: input.expected_order_version,
  });
  const remainingRefundableAmount =
    projection.remaining_refundable_amount_cents;
  let projectedRefund = input.refund;
  let stockRestored = input.refund.stock_restored;
  let stockRestoreSkippedReason: string | null = null;

  if (!projection.is_full_refund) {
    stockRestoreSkippedReason =
      input.refund.delivery_refund_amount_cents > 0
      && input.refund.product_refund_amount_cents === 0
        ? 'delivery_fee_refund_no_stock_restore'
        : 'partial_refund_amount_only';
    if (input.beforeOrder.credit_amount_cents > 0) {
      await safeRecordBusinessEvent(tx, {
        event_type: 'reward_credit_partial_refund_skipped',
        event_level: 'warning',
        event_source: 'refund-service',
        order_id: input.beforeOrder.id,
        refund_id: input.refund.id,
        user_id: input.beforeOrder.user_id,
        payload: {
          rule: 'full_refund_only',
          credit_amount_cents: input.beforeOrder.credit_amount_cents,
          refund_amount_cents: input.refund.refund_amount_cents,
        },
      });
    }
  } else if (
    !stockRestored
    && autoRestoreStockStatuses.includes(input.beforeOrder.order_status)
  ) {
    const restore = await restoreInventoryForRefund(tx, {
      refund_id: input.refund.id,
    });
    stockRestored = restore.applied || restore.idempotent;
    if (stockRestored) {
      projectedRefund = await setRefundStockRestored(
        tx,
        input.refund.id,
        true,
      );
    } else if (restore.quantity === 0) {
      stockRestoreSkippedReason = 'no_remaining_inventory_to_restore';
    }
    if (restore.applied) {
      await recordBusinessEvent(tx, {
        event_type: 'refund_stock_restored',
        event_source: 'refund-service',
        order_id: input.beforeOrder.id,
        refund_id: input.refund.id,
        payload: {
          stock_quantity: restore.quantity,
          ledger_id: restore.ledger_id,
        },
      });
    }
  } else if (projection.is_full_refund && !stockRestored) {
    stockRestoreSkippedReason = 'fulfillment_status_not_auto_restorable';
  }

  await returnOrderCreditAfterFullRefund(tx, {
    order: input.beforeOrder,
    refund_id: input.refund.id,
    is_full_refund: projection.is_full_refund,
  });
  await syncCommissionAfterRefund({
    order_id: input.beforeOrder.id,
    refund_id: input.refund.id,
  }, tx);
  await recordRefundOrderEffects(tx, {
    before_order: input.beforeOrder,
    projected_order: projection.order,
    refund: projectedRefund,
    is_full_refund: projection.is_full_refund,
  });
  await tx.auditLog.create({
    data: {
      action: 'refund_success',
      target_type: 'Refund',
      target_id: input.refund.id,
      payload: {
        order_id: input.beforeOrder.id,
        out_refund_no: input.refund.out_refund_no,
        refund_amount_cents: input.refund.refund_amount_cents,
        product_refund_amount_cents:
          input.refund.product_refund_amount_cents,
        delivery_refund_amount_cents:
          input.refund.delivery_refund_amount_cents,
        total_refund_amount_cents: projection.order.refund_amount_cents,
        remaining_refundable_amount_cents: remainingRefundableAmount,
        is_full_refund: projection.is_full_refund,
        stock_restored: stockRestored,
        stock_restore_policy: stockRestorePolicy,
        stock_restore_skipped_reason: stockRestoreSkippedReason,
      },
    },
  });
  return projectedRefund;
}

async function applyRefundSuccess(
  tx: Prisma.TransactionClient,
  refundId: string,
  notifyInfo: NotifyInfo = {},
  options: { expected_order_version?: number } = {},
) {
  const pending = await getRefundRecord(tx, refundId);
  if (!pending) throw new Error('退款单不存在');
  const order = await lockRefundableOrder(tx, pending.order_id);
  const confirmation = await confirmRefundSuccess(tx, refundId, notifyInfo);
  if (!confirmation.first_success) return confirmation.refund;
  return projectFirstRefundSuccess(tx, {
    beforeOrder: order,
    refund: confirmation.refund,
    expected_order_version: options.expected_order_version,
  });
}

export async function applyMockRefundInTransaction(
  tx: Prisma.TransactionClient,
  input: RefundInput,
  options: { expected_order_version?: number } = {},
) {
  const order = await lockRefundableOrder(tx, input.order_id);
  if (
    options.expected_order_version !== undefined
    && order.version !== options.expected_order_version
  ) {
    throw new RefundOrderVersionConflictError();
  }
  const outRefundNo = buildOutRefundNo(order, input.client_refund_id);
  const existing = await findRefundByClientKey(tx, {
    order_id: order.id,
    out_refund_no: outRefundNo,
    client_refund_id: input.client_refund_id,
    refund_amount_cents: input.refund_amount_cents,
    product_refund_amount_cents: input.product_refund_amount_cents,
    delivery_refund_amount_cents: input.delivery_refund_amount_cents,
  });
  if (existing) {
    const repeated = await confirmRefundSuccess(tx, existing.id, {
      raw_notify: {
        source: 'mock',
        client_refund_id: input.client_refund_id ?? null,
      },
    });
    if (!repeated.first_success) return repeated.refund;
    return projectFirstRefundSuccess(tx, {
      beforeOrder: order,
      refund: repeated.refund,
      expected_order_version: options.expected_order_version,
    });
  }
  let split;
  try {
    split = validateRefundInput(order, input);
  } catch (error) {
    if (
      error instanceof Error
      && error.message === '退款金额超过订单实付金额'
    ) {
      await safeRecordBusinessEvent(tx, {
        event_type: 'refund_amount_exceeded',
        event_level: 'warning',
        event_source: 'refund-service',
        order_id: order.id,
        idempotency_key: input.client_refund_id ?? null,
        payload: {
          refund_amount_cents: input.refund_amount_cents,
          refundable_amount_cents: getRefundableAmount(order),
        },
      });
    }
    throw error;
  }
  const key = {
    order_id: order.id,
    out_refund_no: outRefundNo,
    client_refund_id: input.client_refund_id,
    refund_amount_cents: input.refund_amount_cents,
    product_refund_amount_cents: split.productRefund,
    delivery_refund_amount_cents: split.deliveryRefund,
  };
  await safeRecordBusinessEvent(tx, {
    event_type: 'refund_requested',
    event_source: 'refund-service',
    order_id: order.id,
    idempotency_key: input.client_refund_id,
    payload: {
      refund_amount_cents: input.refund_amount_cents,
      reason: input.reason,
    },
  });
  const refund = await createPendingRefund(tx, { ...key, reason: input.reason });
  const confirmation = await confirmRefundSuccess(tx, refund.id, {
    raw_notify: {
      source: 'mock',
      client_refund_id: input.client_refund_id ?? null,
    },
  });
  if (!confirmation.first_success) return confirmation.refund;
  const success = await projectFirstRefundSuccess(tx, {
    beforeOrder: order,
    refund: confirmation.refund,
    expected_order_version: options.expected_order_version,
  });
  await safeRecordBusinessEvent(tx, {
    event_type: 'refund_mock_success',
    event_source: 'refund-service',
    order_id: order.id,
    refund_id: refund.id,
    idempotency_key: input.client_refund_id,
    after_snapshot: success,
  });
  return success;
}

export async function createMockRefund(input: RefundInput) {
  return prisma.$transaction((tx: Prisma.TransactionClient) =>
    applyMockRefundInTransaction(tx, input),
  );
}

export async function markRefundSuccess(
  refundId: string,
  notifyInfo: NotifyInfo = {},
) {
  return prisma.$transaction((tx: Prisma.TransactionClient) =>
    applyRefundSuccess(tx, refundId, notifyInfo),
  );
}
