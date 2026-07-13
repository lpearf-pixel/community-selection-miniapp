import type { Commission, CommissionStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
type DbClient = Prisma.TransactionClient | typeof prisma;
import { safeRaiseOpsAlert, safeRecordBusinessEvent, safeRecordOrderTimeline } from './logging-service.js';

const settlementDelayDays = 7;
const reviewStates = new Set(['converted', 'withdrawing', 'withdrawn']);

function addDays(date: Date, days: number) { return new Date(date.getTime() + days * 24 * 60 * 60 * 1000); }
function productOriginal(order: { product_amount_cents: number | null; total_amount_cents: number }) { return Math.max(0, order.product_amount_cents ?? order.total_amount_cents); }
function productRemaining(order: { product_amount_cents: number | null; total_amount_cents: number; product_refund_amount_cents: number }) { return Math.max(0, productOriginal(order) - order.product_refund_amount_cents); }
export function calculateCommissionAmount(input: { commission_type: 'none' | 'fixed' | 'percent'; commission_value: number; quantity: number; original_product_amount_cents: number; remaining_product_amount_cents: number }) {
  if (input.commission_type === 'none' || input.commission_value <= 0 || input.remaining_product_amount_cents <= 0) return 0;
  if (input.commission_type === 'percent') return Math.floor((input.remaining_product_amount_cents * input.commission_value) / 100);
  if (input.original_product_amount_cents <= 0) return 0;
  const initialFixedAmount = input.quantity * input.commission_value;
  return Math.floor((initialFixedAmount * input.remaining_product_amount_cents) / input.original_product_amount_cents);
}

export async function getAvailableRewardBalance(tx: DbClient, leaderUserId: string) {
  const entries = await tx.rewardLedger.findMany({ where: { leader_user_id: leaderUserId, affects_available_balance: true }, select: { direction: true, amount_cents: true } });
  const balance = entries.reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents), 0);
  if (balance < 0) {
    await safeRecordBusinessEvent(tx, { event_type: 'reward_available_balance_negative', event_level: 'critical', event_source: 'commission-service', leader_user_id: leaderUserId, payload: { balance } });
    await safeRaiseOpsAlert(tx, { alert_type: 'reward_available_balance_negative', alert_level: 'critical', leader_user_id: leaderUserId, title: '开团服务奖励可用余额为负', message: '账本汇总出现负数，请人工复核', payload: { balance } });
  }
  return balance;
}

export async function appendRewardLedgerEntry(tx: DbClient, input: { leader_user_id: string; commission_id?: string | null; order_id?: string | null; event_type: string; entry_type: string; direction: 'in' | 'out'; amount_cents: number; affects_available_balance: boolean; idempotency_key?: string | null; effective_at?: Date | null; refund_id?: string | null; amount_before_cents?: number | null; amount_after_cents?: number | null; payload?: Prisma.InputJsonValue; conversion_id?: string | null; withdrawal_id?: string | null; remark?: string | null }) {
  if (input.idempotency_key) {
    const existing = await tx.rewardLedger.findUnique({ where: { idempotency_key: input.idempotency_key } });
    if (existing) return { ledger: existing, created: false };
  }
  const before = await getAvailableRewardBalance(tx, input.leader_user_id);
  const delta = input.affects_available_balance ? (input.direction === 'in' ? input.amount_cents : -input.amount_cents) : 0;
  const after = before + delta;
  const ledger = await tx.rewardLedger.create({ data: { leader_user_id: input.leader_user_id, commission_id: input.commission_id ?? null, order_id: input.order_id ?? null, event_type: input.event_type, entry_type: input.entry_type, direction: input.direction, amount_cents: input.amount_cents, affects_available_balance: input.affects_available_balance, balance_after_cents: after, idempotency_key: input.idempotency_key ?? null, effective_at: input.effective_at ?? new Date(), refund_id: input.refund_id ?? null, amount_before_cents: input.amount_before_cents ?? null, amount_after_cents: input.amount_after_cents ?? null, conversion_id: input.conversion_id ?? null, withdrawal_id: input.withdrawal_id ?? null, remark: input.remark ?? null, payload: input.payload ?? {} } });
  return { ledger, created: true };
}

export async function ensureEstimatedCommission(orderId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const order = await client.order.findUnique({ where: { id: orderId }, include: { group_buy: { include: { product: true } } } });
  if (!order || order.pay_status !== 'paid' || !order.group_buy_id || !order.group_buy || !order.leader_user_id) return null;
  if (order.leader_user_id !== order.group_buy.leader_user_id) return null;
  const product = order.group_buy.product;
  const original = productOriginal(order); const remaining = productRemaining(order);
  const amount = calculateCommissionAmount({ commission_type: product.commission_type, commission_value: product.commission_value, quantity: order.quantity, original_product_amount_cents: original, remaining_product_amount_cents: remaining });
  if (amount <= 0) return null;
  const commission = await client.commission.upsert({ where: { order_id_leader_user_id: { order_id: order.id, leader_user_id: order.leader_user_id } }, update: {}, create: { leader_user_id: order.leader_user_id, order_id: order.id, group_buy_id: order.group_buy.id, base_amount_cents: remaining, commission_type: product.commission_type, commission_value: product.commission_value, estimated_amount_cents: amount, final_amount_cents: amount, status: 'estimated' } });
  await safeRecordBusinessEvent(client, { event_type: 'commission_estimated', event_source: 'commission-service', order_id: order.id, group_buy_id: order.group_buy.id, commission_id: commission.id, leader_user_id: order.leader_user_id, payload: { base_amount_cents: remaining, final_amount_cents: commission.final_amount_cents } });
  await safeRecordOrderTimeline(client, { order_id: order.id, event_type: 'commission_estimated', title: '开团服务奖励已预估', payload: { commission_id: commission.id, final_amount_cents: commission.final_amount_cents } });
  return commission;
}

export async function markCommissionPendingForCompletedOrder(orderId: string, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const order = await client.order.findUnique({ where: { id: orderId }, include: { commissions: true } });
  if (!order || order.order_status !== 'completed' || !order.completed_at) return null;
  const commission = order.commissions.find((item) => item.leader_user_id === order.leader_user_id);
  if (!commission || commission.status !== 'estimated') return commission ?? null;
  const updated = await client.commission.update({ where: { id: commission.id }, data: { status: 'pending', available_at: addDays(order.completed_at, settlementDelayDays) } });
  await safeRecordBusinessEvent(client, { event_type: 'commission_pending', event_source: 'commission-service', order_id: order.id, commission_id: commission.id, before_snapshot: commission, after_snapshot: updated });
  await safeRecordOrderTimeline(client, { order_id: order.id, event_type: 'commission_pending', title: '开团服务奖励进入待可用', from_status: commission.status, to_status: updated.status, payload: { commission_id: commission.id, available_at: updated.available_at?.toISOString() ?? null } });
  return updated;
}

export async function releaseDueCommissions(input?: { now?: Date; limit?: number }) {
  const now = input?.now ?? new Date();
  const due = await prisma.commission.findMany({ where: { status: 'pending', available_at: { lte: now }, final_amount_cents: { gt: 0 } }, take: input?.limit ?? 100, orderBy: { available_at: 'asc' } });
  let released_count = 0, ledger_created_count = 0, already_released_count = 0;
  for (const item of due) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.commission.updateMany({ where: { id: item.id, status: 'pending', available_at: { lte: now }, final_amount_cents: { gt: 0 } }, data: { status: 'available' } });
      if (claimed.count !== 1) { already_released_count += 1; return; }
      released_count += 1;
      const res = await appendRewardLedgerEntry(tx, { leader_user_id: item.leader_user_id, commission_id: item.id, order_id: item.order_id, event_type: 'commission_available', entry_type: 'commission_available', direction: 'in', amount_cents: item.final_amount_cents, affects_available_balance: true, idempotency_key: `commission-available:${item.id}`, effective_at: now, amount_before_cents: 0, amount_after_cents: item.final_amount_cents, payload: { available_at: item.available_at?.toISOString() ?? null } });
      if (res.created) ledger_created_count += 1;
      await safeRecordBusinessEvent(tx, { event_type: 'commission_available', event_source: 'commission-service', order_id: item.order_id, group_buy_id: item.group_buy_id, commission_id: item.id, leader_user_id: item.leader_user_id });
      await safeRecordOrderTimeline(tx, { order_id: item.order_id, event_type: 'commission_available', title: '开团服务奖励已可用', from_status: 'pending', to_status: 'available', actor_type: 'scheduler', payload: { commission_id: item.id, final_amount_cents: item.final_amount_cents } });
    });
  }
  return { matched_count: due.length, released_count, already_released_count, ledger_created_count };
}
export async function releaseAvailableCommissions(now = new Date()) { return releaseDueCommissions({ now }); }

export async function syncCommissionAfterRefund(input: string | { order_id: string; refund_id?: string | null }, tx?: Prisma.TransactionClient) {
  const orderId = typeof input === 'string' ? input : input.order_id; const refundId = typeof input === 'string' ? null : input.refund_id ?? null;
  const client = tx ?? prisma;
  const order = await client.order.findUnique({ where: { id: orderId }, include: { group_buy: { include: { product: true } }, commissions: true } });
  if (!order || !order.group_buy || !order.leader_user_id) return null;
  const commission = order.commissions.find((item) => item.leader_user_id === order.leader_user_id); if (!commission) return null;
  const original = productOriginal(order); const remaining = productRemaining(order);
  const recalculated = calculateCommissionAmount({ commission_type: commission.commission_type, commission_value: commission.commission_value, quantity: order.quantity, original_product_amount_cents: original, remaining_product_amount_cents: remaining });
  if (recalculated === commission.final_amount_cents && remaining > 0) return commission;
  const previous = commission.final_amount_cents; const diff = Math.max(0, previous - recalculated); const full = remaining <= 0;
  if (reviewStates.has(commission.status)) {
    const updated = await client.commission.update({ where: { id: commission.id }, data: { review_status: 'needs_review', last_adjusted_at: new Date() } });
    await appendRewardLedgerEntry(client, { leader_user_id: commission.leader_user_id, commission_id: commission.id, order_id: order.id, event_type: 'commission_review_required', entry_type: 'commission_review_required', direction: 'out', amount_cents: diff, affects_available_balance: false, idempotency_key: `commission-review:${commission.id}:${order.product_refund_amount_cents}`, refund_id: refundId, amount_before_cents: previous, amount_after_cents: recalculated, payload: { status: commission.status, product_refund_amount_cents: order.product_refund_amount_cents } });
    await safeRaiseOpsAlert(client, { alert_type: 'commission_refund_review_required', alert_level: 'critical', order_id: order.id, group_buy_id: order.group_buy.id, commission_id: commission.id, leader_user_id: commission.leader_user_id, title: '开团服务奖励退款需人工复核', message: '已转换或提现状态发生商品退款，不自动追款', payload: { previous, recalculated } });
    return updated;
  }
  const available = commission.status === 'available';
  const nextStatus: CommissionStatus = full ? 'cancelled' : commission.status;
  const updated = await client.commission.update({ where: { id: commission.id }, data: { base_amount_cents: remaining, deduct_amount_cents: Math.max(0, commission.estimated_amount_cents - recalculated), final_amount_cents: recalculated, status: nextStatus, last_adjusted_at: new Date() } });
  if (diff > 0) await appendRewardLedgerEntry(client, { leader_user_id: commission.leader_user_id, commission_id: commission.id, order_id: order.id, event_type: available ? 'commission_refund_deduct' : 'commission_refund_adjustment_pending', entry_type: available ? 'commission_refund_deduct' : 'commission_refund_adjustment_pending', direction: 'out', amount_cents: diff, affects_available_balance: available, idempotency_key: `commission-refund-adjust:${commission.id}:${order.product_refund_amount_cents}`, refund_id: refundId, amount_before_cents: previous, amount_after_cents: recalculated, payload: { product_refund_amount_cents: order.product_refund_amount_cents, delivery_refund_amount_cents: order.delivery_refund_amount_cents } });
  await safeRecordBusinessEvent(client, { event_type: full ? 'commission_cancelled_after_refund' : 'commission_adjusted_after_refund', event_level: available ? 'warning' : 'info', event_source: 'commission-service', order_id: order.id, group_buy_id: order.group_buy.id, commission_id: commission.id, leader_user_id: commission.leader_user_id, before_snapshot: commission, after_snapshot: updated, payload: { previous_final_amount_cents: previous, new_final_amount_cents: recalculated, product_refund_amount_cents: order.product_refund_amount_cents } });
  return updated;
}

export async function backfillAvailableRewardLedgers(now = new Date()) {
  const rows = await prisma.commission.findMany({ where: { available_at: { lte: now }, status: { in: ['available', 'converted', 'withdrawing', 'withdrawn', 'frozen'] }, final_amount_cents: { gt: 0 } } });
  let created = 0;
  for (const item of rows) await prisma.$transaction(async (tx) => { const res = await appendRewardLedgerEntry(tx, { leader_user_id: item.leader_user_id, commission_id: item.id, order_id: item.order_id, event_type: 'commission_available_backfill', entry_type: 'commission_available', direction: 'in', amount_cents: item.final_amount_cents, affects_available_balance: true, idempotency_key: `commission-available:${item.id}`, effective_at: item.available_at ?? now, amount_before_cents: 0, amount_after_cents: item.final_amount_cents, payload: { backfill: true } }); if (res.created) created += 1; });
  return { matched_count: rows.length, ledger_created_count: created };
}

export function toLeaderCommissionDto(item: Commission & { order?: { order_no: string } | null; group_buy?: { community_id: string; product?: { name: string } | null; community?: { name: string } | null } | null }) {
  return { commission_id: item.id, order_id: item.order_id, order_no: item.order?.order_no ?? '', group_buy_id: item.group_buy_id, product_name: item.group_buy?.product?.name ?? '', community_name: item.group_buy?.community?.name ?? '', base_amount_cents: item.base_amount_cents, estimated_amount_cents: item.estimated_amount_cents, deduct_amount_cents: item.deduct_amount_cents, final_amount_cents: item.final_amount_cents, status: item.status, available_at: item.available_at, created_at: item.created_at, updated_at: item.updated_at, review_status: item.review_status, user_status_text: item.status === 'pending' ? '完成后第 7 天可用' : item.status === 'available' ? '已可用' : item.status === 'cancelled' ? '已取消' : '开团服务奖励' };
}
