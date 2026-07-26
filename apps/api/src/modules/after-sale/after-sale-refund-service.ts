import type {
  AfterSaleCase,
  Order,
  Prisma,
} from '@prisma/client';
import {
  recordBusinessEvent,
  recordOrderTimeline,
} from '../../services/logging-service.js';

type AfterSaleWithOrder = AfterSaleCase & { order: Order };

function payload(item: AfterSaleCase, extra: Record<string, unknown> = {}) {
  return {
    after_sale_case_id: item.id,
    order_id: item.order_id,
    product_id: item.product_id,
    group_buy_id: item.group_buy_id,
    user_id: item.user_id,
    type: item.type,
    status: item.status,
    resolution_type: item.resolution_type,
    requested_refund_cents: item.requested_refund_cents,
    approved_refund_cents: item.approved_refund_cents,
    approved_product_refund_cents: item.approved_product_refund_cents,
    approved_delivery_refund_cents: item.approved_delivery_refund_cents,
    responsibility: item.responsibility,
    ...extra,
  };
}

export async function claimApprovedAfterSaleForRefund(
  tx: Prisma.TransactionClient,
  input: {
    after_sale_case_id: string;
    admin_user_id: string;
    admin_note: string;
  },
): Promise<{ before: AfterSaleWithOrder; after: AfterSaleWithOrder }> {
  const before = await tx.afterSaleCase.findUnique({
    where: { id: input.after_sale_case_id },
    include: { order: true },
  });
  if (!before) throw new Error('售后工单不存在');
  const changed = await tx.afterSaleCase.updateMany({
    where: { id: before.id, status: 'approved' },
    data: {
      status: 'processing',
      resolved_by_admin_id: input.admin_user_id,
      admin_note: input.admin_note,
    },
  });
  if (changed.count !== 1) throw new Error('当前售后状态不可执行退款');
  const after = await tx.afterSaleCase.findUniqueOrThrow({
    where: { id: before.id },
    include: { order: true },
  });
  return { before, after };
}

export async function resolveAfterSaleWithRefund(
  tx: Prisma.TransactionClient,
  input: {
    after_sale_case_id: string;
    refund_id: string;
    admin_user_id: string;
    admin_note: string;
    idempotency_key: string;
  },
): Promise<AfterSaleCase> {
  const before = await tx.afterSaleCase.findUnique({
    where: { id: input.after_sale_case_id },
  });
  if (!before) throw new Error('售后工单不存在');
  if (before.status !== 'processing') {
    throw new Error('当前售后状态不可执行退款');
  }
  const after = await tx.afterSaleCase.update({
    where: { id: before.id },
    data: {
      status: 'resolved',
      refund_id: input.refund_id,
      resolved_at: new Date(),
    },
  });
  const eventPayload = payload(after, {
    refund_id: input.refund_id,
    idempotency_key: input.idempotency_key,
  });
  await tx.afterSaleLog.create({
    data: {
      after_sale_case_id: after.id,
      action: 'after_sale_refund_executed',
      actor_type: 'admin',
      actor_id: input.admin_user_id,
      note: input.admin_note,
      payload: eventPayload,
    },
  });
  await recordBusinessEvent(tx, {
    event_type: 'after_sale_refund_executed',
    event_source: 'after-sale-refund-service',
    order_id: after.order_id,
    group_buy_id: after.group_buy_id,
    user_id: after.user_id,
    refund_id: input.refund_id,
    idempotency_key: input.idempotency_key,
    before_snapshot: before,
    after_snapshot: after,
    payload: eventPayload,
  });
  await recordOrderTimeline(tx, {
    order_id: after.order_id,
    event_type: 'after_sale_refund_executed',
    title: '售后退款已执行',
    actor_type: 'admin',
    actor_user_id: input.admin_user_id,
    payload: eventPayload,
  });
  return after;
}
