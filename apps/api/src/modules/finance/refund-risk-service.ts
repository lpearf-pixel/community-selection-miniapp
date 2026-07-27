import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

type RiskLevel = 'high' | 'medium' | 'low';
type RiskQuery = { risk_level?: RiskLevel; order_no?: string; group_buy_id?: string; from?: string; to?: string; page?: number; page_size?: number };
type RiskItem = {
  risk_id: string;
  risk_level: RiskLevel;
  risk_type: string;
  order_id: string;
  order_no: string;
  group_buy_id: string | null;
  pay_status: string;
  order_status: string;
  refund_status: string;
  pay_amount_cents: number;
  refund_amount_cents: number;
  refund_record_amount_cents: number;
  duplicated_key: string;
  receiver_name: string;
  receiver_phone_masked: string;
  reason: string;
  suggested_action: string;
  created_at: Date;
  updated_at: Date;
};

function maskPhone(phone: string | null | undefined): string {
  return phone && phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone ? '****' : '';
}

function dateWhere(query: RiskQuery): Prisma.DateTimeFilter | undefined {
  const where: Prisma.DateTimeFilter = {};
  if (query.from) where.gte = new Date(query.from);
  if (query.to) where.lte = new Date(query.to);
  return Object.keys(where).length ? where : undefined;
}

function riskWhere(query: RiskQuery): Prisma.OrderWhereInput {
  return { created_at: dateWhere(query), order_no: query.order_no ? { contains: query.order_no } : undefined, group_buy_id: query.group_buy_id };
}

function addRisk(items: RiskItem[], order: Prisma.OrderGetPayload<{ include: { refunds: true; group_buy: true } }>, risk_level: RiskLevel, risk_type: string, reason: string, suggested_action: string, refund_record_amount_cents = 0, duplicated_key = '') {
  items.push({
    risk_id: `${order.id}:${risk_type}:${duplicated_key || 'order'}`,
    risk_level,
    risk_type,
    order_id: order.id,
    order_no: order.order_no,
    group_buy_id: order.group_buy_id,
    pay_status: order.pay_status,
    order_status: order.order_status,
    refund_status: order.refund_status,
    pay_amount_cents: order.pay_amount_cents,
    refund_amount_cents: order.refund_amount_cents,
    refund_record_amount_cents,
    duplicated_key,
    receiver_name: order.receiver_name,
    receiver_phone_masked: maskPhone(order.receiver_phone),
    reason,
    suggested_action,
    created_at: order.created_at,
    updated_at: order.updated_at
  });
}

async function buildRisks(query: RiskQuery): Promise<RiskItem[]> {
  const orders = await prisma.order.findMany({ where: riskWhere(query), include: { refunds: true, group_buy: true }, orderBy: { updated_at: 'desc' } });
  const allRefunds = await prisma.refund.findMany({ where: { order: riskWhere(query) } });
  const transactionCount = new Map<string, number>();
  const outRefundNoCount = new Map<string, number>();
  for (const refund of allRefunds) {
    const refund_transaction_id = refund.refund_id ?? '';
    if (refund_transaction_id) transactionCount.set(refund_transaction_id, (transactionCount.get(refund_transaction_id) ?? 0) + 1);
    if (refund.out_refund_no) outRefundNoCount.set(refund.out_refund_no, (outRefundNoCount.get(refund.out_refund_no) ?? 0) + 1);
  }

  const items: RiskItem[] = [];
  for (const order of orders) {
    const refundRecordAmount = order.refunds.reduce((total, refund) => total + refund.refund_amount_cents, 0);
    if (order.refund_amount_cents > order.pay_amount_cents) addRisk(items, order, 'high', 'refund_amount_over_pay_amount', '订单已记录退款金额大于支付金额', '暂停人工处理，核对退款台账与支付凭证', refundRecordAmount);
    if (refundRecordAmount > order.pay_amount_cents) addRisk(items, order, 'high', 'cumulative_refund_amount_over_pay_amount', '累计退款记录金额大于支付金额', '核对重复退款记录，必要时走人工更正流程', refundRecordAmount);
    if (order.pay_status === 'paid' && !order.paid_at) addRisk(items, order, 'medium', 'paid_status_missing_paid_at', '支付状态为 paid 但 paid_at 为空', '核对 mock 支付记录与订单时间线', refundRecordAmount);
    if (order.refund_status === 'success' && order.refund_amount_cents === 0) addRisk(items, order, 'medium', 'refunded_status_zero_amount', '退款状态为 success 但退款金额为 0', '核对订单退款状态边界', refundRecordAmount);
    if (order.refunds.length > 0 && refundRecordAmount !== order.refund_amount_cents) addRisk(items, order, 'medium', 'refund_record_order_amount_mismatch', '退款流水合计与订单退款金额不一致', '以人工凭证为准复核并记录审计说明', refundRecordAmount);
    if (order.refund_status !== 'none' && order.pay_status !== 'paid') addRisk(items, order, 'medium', 'refund_status_without_paid_order', '非 paid 订单存在退款状态', '确认未支付或关闭订单没有被错误标记退款', refundRecordAmount);
    if (['closed', 'unpaid'].includes(order.order_status) && order.pay_status === 'paid') addRisk(items, order, 'medium', 'pay_status_order_status_inconsistent', '订单状态与支付状态组合异常', '核对订单关闭/支付幂等边界', refundRecordAmount);
    if (order.group_buy?.status === 'failed' && order.pay_status === 'paid' && order.refund_status === 'none') addRisk(items, order, 'low', 'failed_group_buy_paid_pending_manual_refund', '失败团购下 paid 订单待人工退款处理', '进入人工退款台账逐笔处理', refundRecordAmount);
    for (const refund of order.refunds) {
      if (refund.refund_amount_cents > order.pay_amount_cents) addRisk(items, order, 'high', 'single_refund_amount_over_pay_amount', '单笔退款记录金额大于支付金额', '冻结该退款记录后人工复核', refund.refund_amount_cents, refund.out_refund_no);
      const refund_transaction_id = refund.refund_id ?? '';
      if (refund_transaction_id && (transactionCount.get(refund_transaction_id) ?? 0) > 1) addRisk(items, order, 'high', 'duplicated_refund_transaction_id', '同一 refund_transaction_id 多次出现', '核对重复流水并避免重复人工登记', refund.refund_amount_cents, refund_transaction_id);
      if (refund.out_refund_no && (outRefundNoCount.get(refund.out_refund_no) ?? 0) > 1) addRisk(items, order, 'high', 'duplicated_out_refund_no', '同一 out_refund_no 多次出现', '按外部退款单号进行幂等复核', refund.refund_amount_cents, refund.out_refund_no);
    }
  }
  return query.risk_level ? items.filter((item) => item.risk_level === query.risk_level) : items;
}

function summary(items: RiskItem[]) {
  return {
    total_risk_count: items.length,
    high_risk_count: items.filter((item) => item.risk_level === 'high').length,
    medium_risk_count: items.filter((item) => item.risk_level === 'medium').length,
    low_risk_count: items.filter((item) => item.risk_level === 'low').length,
    affected_order_count: new Set(items.map((item) => item.order_id)).size,
    duplicated_refund_transaction_count: items.filter((item) => item.risk_type === 'duplicated_refund_transaction_id' || item.risk_type === 'duplicated_out_refund_no').length,
    over_refund_count: items.filter((item) => item.risk_type.includes('over_pay_amount')).length,
    inconsistent_status_count: items.filter((item) => item.risk_type.includes('status') || item.risk_type.includes('mismatch')).length
  };
}

export async function getRefundPaymentRiskOverview(query: RiskQuery) { return summary(await buildRisks(query)); }

export async function listRefundPaymentRisks(query: RiskQuery) {
  const page = Math.max(1, query.page ?? 1);
  const page_size = Math.min(100, Math.max(1, query.page_size ?? 20));
  const risks = await buildRisks(query);
  return { total: risks.length, page, page_size, summary: summary(risks), items: risks.slice((page - 1) * page_size, page * page_size) };
}

export function sanitizeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return safe;
}

export function escapeCsvCell(value: unknown): string { return `"${sanitizeCsvCell(value).replace(/"/g, '""')}"`; }

export async function exportRefundPaymentRiskCsv(query: RiskQuery): Promise<string> {
  const rows = (await listRefundPaymentRisks({ ...query, page: 1, page_size: 100 })).items;
  const headers = ['risk_id','risk_level','risk_type','order_id','order_no','group_buy_id','pay_status','order_status','refund_status','pay_amount_cents','refund_amount_cents','refund_record_amount_cents','duplicated_key','receiver_name','receiver_phone_masked','reason','suggested_action','created_at','updated_at'];
  return ['\uFEFF' + headers.join(','), ...rows.map((row) => headers.map((key) => escapeCsvCell(row[key as keyof RiskItem])).join(','))].join('\n');
}

export async function validateManualRefundSafety(input: { order_id: string; refund_amount_cents: number; refund_transaction_id?: string | null; out_refund_no?: string | null }) {
  const warnings: string[] = [];
  const blocking_reasons: string[] = [];
  const order = await prisma.order.findUnique({ where: { id: input.order_id }, include: { refunds: true, group_buy: true } });
  if (!order) blocking_reasons.push('order exists check failed');
  if (!Number.isInteger(input.refund_amount_cents) || input.refund_amount_cents <= 0) blocking_reasons.push('refund_amount_cents > 0 required');
  if (order) {
    const cumulative_refund_amount = order.refund_amount_cents + input.refund_amount_cents;
    if (order.pay_status !== 'paid') blocking_reasons.push('pay_status must be paid before refund');
    if (['closed', 'unpaid'].includes(order.order_status)) blocking_reasons.push('closed/canceled order guard for payment or refund');
    if (order.refund_status === 'success' || order.order_status === 'refunded' || order.refund_amount_cents >= order.pay_amount_cents) blocking_reasons.push('already refunded guard');
    if (input.refund_amount_cents > order.pay_amount_cents) blocking_reasons.push('refund_amount_cents <= pay_amount_cents required');
    if (cumulative_refund_amount > order.pay_amount_cents) blocking_reasons.push('cumulative_refund_amount <= pay_amount_cents required');
    if (order.group_buy_id && order.group_buy?.status !== 'failed' && ['paid', 'grouped', 'preparing', 'ready'].includes(order.order_status)) warnings.push('status compatibility requires existing after-sale/admin manual flow for non-failed groups');
  }
  if (input.refund_transaction_id) {
    const duplicate = await prisma.refund.findFirst({ where: { refund_id: input.refund_transaction_id } });
    if (duplicate) blocking_reasons.push('duplicate refund_transaction_id check');
  }
  if (input.out_refund_no) {
    const duplicate = await prisma.refund.findUnique({ where: { out_refund_no: input.out_refund_no } });
    if (duplicate) blocking_reasons.push('duplicate out_refund_no check');
  }
  const risk_level: RiskLevel | undefined = blocking_reasons.length ? 'high' : warnings.length ? 'medium' : undefined;
  return { ok: blocking_reasons.length === 0, risk_level, warnings, blocking_reasons };
}
