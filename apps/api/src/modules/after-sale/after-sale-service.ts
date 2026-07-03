import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { createMockRefund } from '../../services/refund-service.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../../services/logging-service.js';
import { recordBatchLoss } from '../inventory/inventory-service.js';

const afterSaleTypes = ['bad_quality', 'short_weight', 'missing_item', 'wrong_item', 'damaged', 'not_fresh', 'other'] as const;
const activeStatuses = ['submitted', 'reviewing', 'approved', 'processing'] as const;
const cancellableStatuses = ['submitted', 'reviewing'] as const;
const reviewStatuses = ['reviewing', 'approved', 'rejected'] as const;
const resolutionTypes = ['refund', 'partial_refund', 'resend', 'compensation_note', 'reject', 'manual_note'] as const;
const responsibilities = ['supplier', 'platform', 'leader', 'customer', 'unknown'] as const;

type Actor = { actor_type: 'user' | 'admin' | 'system'; actor_id?: string | null };
type AfterSaleType = typeof afterSaleTypes[number];
type ResolutionType = typeof resolutionTypes[number];
type Responsibility = typeof responsibilities[number];

type AfterSaleCasePayload = {
  id: string;
  order_id: string;
  product_id: string | null;
  group_buy_id: string | null;
  user_id: string | null;
  type: string;
  status: string;
  resolution_type: string | null;
  requested_refund_cents: number | null;
  approved_refund_cents: number | null;
  responsibility: string | null;
};

export type CreateAfterSaleInput = {
  order_id: string;
  user_id?: string | null;
  product_id?: string | null;
  type: string;
  reason: string;
  description?: string | null;
  requested_refund_cents?: number | null;
  evidence_image_urls?: string[] | null;
};

export type ReviewAfterSaleInput = {
  status: string;
  approved_refund_cents?: number | null;
  resolution_type?: string | null;
  responsibility?: string | null;
  admin_note?: string | null;
  admin_user_id?: string | null;
};

export type ResolveAfterSaleInput = {
  resolution_type: string;
  approved_refund_cents?: number | null;
  admin_note?: string | null;
  admin_user_id?: string | null;
};

export type AddAfterSaleNoteInput = { admin_note: string; admin_user_id?: string | null };

export type LinkAfterSaleLossInput = {
  product_id: string;
  batch_id?: string | null;
  quantity: number;
  reason: string;
  remark?: string | null;
  admin_user_id?: string | null;
};

function ensureIn<T extends readonly string[]>(value: string | null | undefined, values: T, message: string): T[number] {
  if (!value || !values.includes(value as T[number])) throw new Error(message);
  return value as T[number];
}

function ensurePositiveInteger(value: unknown, message: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(message);
  return parsed;
}

function afterSalePayload(afterSaleCase: AfterSaleCasePayload, extra: Record<string, unknown> = {}) {
  return {
    after_sale_case_id: afterSaleCase.id,
    order_id: afterSaleCase.order_id,
    product_id: afterSaleCase.product_id,
    group_buy_id: afterSaleCase.group_buy_id,
    user_id: afterSaleCase.user_id,
    type: afterSaleCase.type,
    status: afterSaleCase.status,
    resolution_type: afterSaleCase.resolution_type,
    requested_refund_cents: afterSaleCase.requested_refund_cents,
    approved_refund_cents: afterSaleCase.approved_refund_cents,
    responsibility: afterSaleCase.responsibility,
    ...extra
  };
}

async function recordAfterSaleLog(tx: Prisma.TransactionClient, afterSaleCase: AfterSaleCasePayload, action: string, actor: Actor, note?: string | null, extra: Record<string, unknown> = {}) {
  const payload = afterSalePayload(afterSaleCase, extra);
  await tx.afterSaleLog.create({
    data: {
      after_sale_case_id: afterSaleCase.id,
      action,
      actor_type: actor.actor_type,
      actor_id: actor.actor_id ?? null,
      note: note ?? null,
      payload
    }
  });
  await safeRecordBusinessEvent(tx, {
    event_type: action,
    event_source: 'after-sale-service',
    order_id: afterSaleCase.order_id,
    group_buy_id: afterSaleCase.group_buy_id,
    user_id: afterSaleCase.user_id,
    payload: { ...payload, actor_type: actor.actor_type, actor_id: actor.actor_id ?? null }
  });
  await safeRecordOrderTimeline(tx, {
    order_id: afterSaleCase.order_id,
    event_type: action,
    title: action === 'after_sale_submitted' ? '用户提交售后申请' : '售后客服状态更新',
    actor_type: actor.actor_type === 'admin' ? 'admin' : 'user',
    actor_user_id: actor.actor_id ?? null,
    payload
  });
}

function normalizeEvidence(value: string[] | null | undefined) {
  if (!value) return Prisma.JsonNull;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('售后凭证必须是图片 URL 字符串数组');
  return value as Prisma.InputJsonValue;
}

export async function createAfterSaleCase(input: CreateAfterSaleInput) {
  const type = ensureIn(input.type, afterSaleTypes, '售后类型不合法') as AfterSaleType;
  if (!input.order_id || !input.reason) throw new Error('缺少售后必填字段');
  const requestedRefundCents = input.requested_refund_cents == null ? null : ensurePositiveInteger(input.requested_refund_cents, '申请退款金额必须大于 0');
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({ where: { id: input.order_id }, include: { group_buy: true } });
    if (!order) throw new Error('订单不存在');
    if (input.user_id && input.user_id !== order.user_id) throw new Error('不能为无关订单提交售后');
    if (order.pay_status !== 'paid' || ['unpaid', 'closed', 'refunded'].includes(order.order_status)) throw new Error('当前订单状态不可提交售后');
    const productId = input.product_id ?? order.group_buy?.product_id ?? null;
    if (!productId) throw new Error('售后商品不存在');
    const existing = await tx.afterSaleCase.findFirst({
      where: {
        order_id: order.id,
        product_id: productId,
        type,
        status: { in: [...activeStatuses] }
      }
    });
    if (existing) throw new Error('同一订单商品问题已有处理中售后');
    const created = await tx.afterSaleCase.create({
      data: {
        order_id: order.id,
        user_id: order.user_id,
        group_buy_id: order.group_buy_id,
        product_id: productId,
        type,
        status: 'submitted',
        reason: input.reason,
        description: input.description ?? null,
        requested_refund_cents: requestedRefundCents,
        evidence_image_urls: normalizeEvidence(input.evidence_image_urls),
        customer_note: input.description ?? null
      }
    });
    await recordAfterSaleLog(tx, created, 'after_sale_submitted', { actor_type: 'user', actor_id: order.user_id }, input.reason);
    return tx.afterSaleCase.findUniqueOrThrow({ where: { id: created.id }, include: { logs: true, order: true } });
  });
}

export async function cancelAfterSaleCase(id: string, actor: Actor = { actor_type: 'user' }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.afterSaleCase.findUnique({ where: { id } });
    if (!current) throw new Error('售后工单不存在');
    if (!cancellableStatuses.some((status) => status === current.status)) throw new Error('当前售后状态不可取消');
    const updated = await tx.afterSaleCase.update({ where: { id }, data: { status: 'cancelled', cancelled_at: new Date() } });
    await recordAfterSaleLog(tx, updated, 'after_sale_cancelled', actor, '用户取消售后');
    return updated;
  });
}

export async function reviewAfterSaleCase(id: string, input: ReviewAfterSaleInput) {
  const status = ensureIn(input.status, reviewStatuses, '售后审核状态不合法');
  const resolutionType = input.resolution_type ? ensureIn(input.resolution_type, resolutionTypes, '售后处理结果不合法') as ResolutionType : null;
  const responsibility = input.responsibility ? ensureIn(input.responsibility, responsibilities, '售后责任方不合法') as Responsibility : null;
  const approvedRefundCents = input.approved_refund_cents == null ? null : ensurePositiveInteger(input.approved_refund_cents, '审核退款金额必须大于 0');
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.afterSaleCase.findUnique({ where: { id } });
    if (!current) throw new Error('售后工单不存在');
    if (!['submitted', 'reviewing'].includes(current.status)) throw new Error('当前售后状态不可审核');
    const updated = await tx.afterSaleCase.update({
      where: { id },
      data: {
        status,
        resolution_type: resolutionType,
        approved_refund_cents: approvedRefundCents ?? current.approved_refund_cents,
        responsibility,
        admin_note: input.admin_note ?? current.admin_note,
        reviewed_by_admin_id: input.admin_user_id ?? null,
        reviewed_at: new Date()
      }
    });
    const eventType = status === 'approved' ? 'after_sale_approved' : status === 'rejected' ? 'after_sale_rejected' : 'after_sale_reviewed';
    await recordAfterSaleLog(tx, updated, eventType, { actor_type: 'admin', actor_id: input.admin_user_id ?? null }, input.admin_note, { previous_status: current.status });
    return updated;
  });
}

export async function resolveAfterSaleCase(id: string, input: ResolveAfterSaleInput) {
  const resolutionType = ensureIn(input.resolution_type, resolutionTypes, '售后处理结果不合法') as ResolutionType;
  const approvedRefundCents = input.approved_refund_cents == null ? null : ensurePositiveInteger(input.approved_refund_cents, '处理退款金额必须大于 0');
  const current = await prisma.afterSaleCase.findUnique({ where: { id }, include: { order: true } });
  if (!current) throw new Error('售后工单不存在');
  if (['resolved', 'closed', 'cancelled', 'rejected'].includes(current.status)) throw new Error('当前售后状态不可解决');
  const refundAmount = approvedRefundCents ?? current.approved_refund_cents;
  if ((resolutionType === 'refund' || resolutionType === 'partial_refund') && !refundAmount) throw new Error('退款类售后必须填写审核退款金额');
  const processing = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.afterSaleCase.update({
      where: { id },
      data: { status: 'processing', resolution_type: resolutionType, approved_refund_cents: refundAmount, admin_note: input.admin_note ?? current.admin_note, resolved_by_admin_id: input.admin_user_id ?? null }
    });
    await recordAfterSaleLog(tx, updated, 'after_sale_resolved', { actor_type: 'admin', actor_id: input.admin_user_id ?? null }, input.admin_note, { resolution_type: resolutionType });
    return updated;
  });
  let refundId: string | null = null;
  if ((resolutionType === 'refund' || resolutionType === 'partial_refund') && refundAmount) {
    const refund = await createMockRefund({
      order_id: current.order_id,
      refund_amount_cents: refundAmount,
      reason: `售后处理：${current.reason}`,
      client_refund_id: `after-sale-${id}`
    });
    refundId = refund.id;
  }
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.afterSaleCase.update({
      where: { id },
      data: { status: 'resolved', resolution_type: resolutionType, refund_id: refundId, resolved_at: new Date() }
    });
    if (refundId) {
      await recordAfterSaleLog(tx, updated, 'after_sale_refund_created', { actor_type: 'admin', actor_id: input.admin_user_id ?? null }, input.admin_note, { refund_id: refundId, processing_case_id: processing.id });
    }
    return updated;
  });
}

export async function addAfterSaleNote(id: string, input: AddAfterSaleNoteInput) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.afterSaleCase.findUnique({ where: { id } });
    if (!current) throw new Error('售后工单不存在');
    const updated = await tx.afterSaleCase.update({ where: { id }, data: { admin_note: input.admin_note } });
    await recordAfterSaleLog(tx, updated, 'after_sale_note_added', { actor_type: 'admin', actor_id: input.admin_user_id ?? null }, input.admin_note);
    return updated;
  });
}

export async function linkAfterSaleLoss(id: string, input: LinkAfterSaleLossInput) {
  const quantity = ensurePositiveInteger(input.quantity, '损耗数量必须大于 0');
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.afterSaleCase.findUnique({ where: { id } });
    if (!current) throw new Error('售后工单不存在');
    let lossId: string;
    if (input.batch_id) {
      const result = await recordBatchLoss(tx, {
        batch_id: input.batch_id,
        quantity,
        loss_type: input.reason,
        reason: input.remark ?? input.reason,
        responsible_type: current.responsibility ?? 'unknown',
        admin_user_id: input.admin_user_id ?? 'system'
      });
      lossId = result.loss.id;
    } else {
      const product = await tx.product.findUnique({ where: { id: input.product_id } });
      if (!product) throw new Error('商品不存在');
      if (product.stock < quantity) throw new Error('商品库存不足');
      const stockAfter = product.stock - quantity;
      const loss = await tx.inventoryLoss.create({
        data: {
          product_id: input.product_id,
          loss_type: input.reason,
          quantity,
          stock_unit: product.stock_unit,
          reason: input.remark ?? input.reason,
          responsible_type: current.responsibility ?? 'unknown',
          operator_admin_id: input.admin_user_id ?? null,
          payload: afterSalePayload(current, { source: 'after_sale' })
        }
      });
      await tx.product.update({ where: { id: input.product_id }, data: { stock: stockAfter } });
      await tx.stockLedger.create({
        data: {
          product_id: input.product_id,
          source_type: 'after_sale_loss_out',
          source_id: loss.id,
          direction: 'out',
          quantity,
          stock_before: product.stock,
          stock_after: stockAfter,
          operator_type: 'admin',
          operator_id: input.admin_user_id ?? null,
          remark: input.remark ?? input.reason,
          payload: afterSalePayload(current, { stock_unit: product.stock_unit })
        }
      });
      lossId = loss.id;
    }
    const updated = await tx.afterSaleCase.update({ where: { id }, data: { inventory_loss_id: lossId } });
    await recordAfterSaleLog(tx, updated, 'after_sale_loss_linked', { actor_type: 'admin', actor_id: input.admin_user_id ?? null }, input.remark ?? input.reason, { inventory_loss_id: lossId, quantity, product_id: input.product_id, batch_id: input.batch_id ?? null });
    return updated;
  });
}
