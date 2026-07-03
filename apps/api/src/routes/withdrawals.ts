import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../services/logging-service.js';

type LeaderQuery = { leader_user_id?: string; openid?: string };
type WithdrawBody = { leader_user_id?: string; openid?: string; amount_cents?: number };
type ReviewBody = { admin_user_id?: string; reason?: string };
type TaxReviewBody = {
  tax_mode?: 'none' | 'withheld' | 'invoice';
  tax_amount_cents?: number;
  tax_rate_basis?: string;
  invoice_required?: boolean;
  invoice_status?: string;
  tax_remark?: string;
};
type TaxRecordQuery = { leader_user_id?: string; source_type?: string; source_id?: string; tax_status?: string; from?: string; to?: string };

async function resolveLeaderId(input: LeaderQuery) {
  if (input.leader_user_id) return input.leader_user_id;
  if (!input.openid) throw new Error('缺少开团人标识');
  const user = await prisma.user.findUnique({ where: { openid: input.openid } });
  if (!user || user.role !== 'leader') throw new Error('开团人不存在');
  return user.id;
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('提现金额必须大于 0');
  return amount;
}

function parseDateRange(query: { from?: string; to?: string }) {
  return {
    ...(query.from || query.to
      ? {
        created_at: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {})
        }
      }
      : {})
  };
}

function resolveTaxStatus(body: TaxReviewBody) {
  if (body.tax_mode === 'withheld') return 'calculated';
  if (body.tax_mode === 'none') return 'completed';
  return body.invoice_status === 'verified' ? 'completed' : 'pending_invoice';
}

function uniqueOrderIds(orderIds: Array<string | null | undefined> = []) {
  return Array.from(new Set(orderIds.filter((orderId): orderId is string => Boolean(orderId))));
}

async function logWithdrawalEvent(tx: Prisma.TransactionClient, input: {
  event_type: string;
  withdrawal: { id: string; leader_user_id: string; amount_cents: number; status: string };
  commissionIds?: string[];
  orderIds?: string[];
  admin_user_id?: string | null;
  extraPayload?: Record<string, unknown>;
  before?: unknown;
  after?: unknown;
  message?: string;
}) {
  const orderIds = uniqueOrderIds(input.orderIds);
  const payload = {
    withdrawal_id: input.withdrawal.id,
    amount_cents: input.withdrawal.amount_cents,
    commission_ids: input.commissionIds ?? [],
    order_ids: orderIds,
    action: input.event_type,
    status: input.withdrawal.status,
    admin_user_id: input.admin_user_id ?? null,
    ...(input.extraPayload ?? {}),
    ...(input.event_type === 'withdrawal_mark_paid' && 'tax_amount_cents' in input.withdrawal
      ? {
        gross_amount_cents: input.withdrawal.amount_cents,
        tax_amount_cents: (input.withdrawal as { tax_amount_cents?: number }).tax_amount_cents ?? 0,
        payable_amount_cents: (input.withdrawal as { payable_amount_cents?: number }).payable_amount_cents ?? input.withdrawal.amount_cents,
        tax_mode: (input.withdrawal as { tax_mode?: string }).tax_mode,
        tax_status: (input.withdrawal as { tax_status?: string }).tax_status,
        invoice_status: (input.withdrawal as { invoice_status?: string }).invoice_status
      }
      : {})
  };
  await safeRecordBusinessEvent(tx, {
    event_type: input.event_type,
    event_source: 'withdrawals-route',
    withdrawal_id: input.withdrawal.id,
    leader_user_id: input.withdrawal.leader_user_id,
    before_snapshot: input.before,
    after_snapshot: input.after ?? input.withdrawal,
    payload,
    message: input.message ?? null
  });
  for (const orderId of orderIds) {
    await safeRecordBusinessEvent(tx, {
      event_type: input.event_type,
      event_source: 'withdrawals-route',
      order_id: orderId,
      withdrawal_id: input.withdrawal.id,
      leader_user_id: input.withdrawal.leader_user_id,
      before_snapshot: input.before,
      after_snapshot: input.after ?? input.withdrawal,
      payload,
      message: input.message ?? null
    });
    await safeRecordOrderTimeline(tx, {
      order_id: orderId,
      event_type: input.event_type,
      title: input.event_type === 'withdrawal_requested' ? '开团服务奖励提现申请已提交' : '开团服务奖励提现状态已更新',
      payload: { withdrawal_id: input.withdrawal.id, amount_cents: input.withdrawal.amount_cents, status: input.withdrawal.status }
    });
  }
}


async function writeAdminAuditLog(tx: Prisma.TransactionClient, request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }, input: { action: string; target_id: string; payload?: unknown }) {
  await tx.adminAuditLog.create({
    data: {
      admin_user_id: request.adminUser?.id ?? null,
      action: input.action,
      target_type: 'Withdrawal',
      target_id: input.target_id,
      ip_address: request.ip ?? null,
      user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      payload: input.payload === undefined ? Prisma.JsonNull : input.payload as Prisma.InputJsonValue
    }
  });
}

export function registerWithdrawalRoutes(app: FastifyInstance) {
  app.get('/api/leaders/me/withdrawals', async (request, reply) => {
    try {
      const leaderUserId = await resolveLeaderId(request.query as LeaderQuery);
      const withdrawals = await prisma.withdrawal.findMany({ where: { leader_user_id: leaderUserId }, orderBy: { created_at: 'desc' } });
      return ok(withdrawals);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '查询提现申请失败');
    }
  });


  app.get('/api/leaders/me/withdrawable-commissions', async (request, reply) => {
    try {
      const leaderUserId = await resolveLeaderId(request.query as LeaderQuery);
      const commissions = await prisma.commission.findMany({
        where: { leader_user_id: leaderUserId, status: 'available', withdrawal_id: null, final_amount_cents: { gt: 0 } },
        orderBy: { created_at: 'asc' }
      });
      const availableAmount = commissions.reduce((sum, item) => sum + item.final_amount_cents, 0);
      return ok({ available_amount_cents: availableAmount, commissions });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '查询可提现开团服务奖励失败');
    }
  });

  app.post('/api/leaders/me/withdrawals', async (request, reply) => {
    try {
      const body = request.body as WithdrawBody;
      const leaderUserId = await resolveLeaderId(body);
      const amount = parseAmount(body.amount_cents);
      const withdrawal = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const available = await tx.commission.findMany({
          where: { leader_user_id: leaderUserId, status: 'available', withdrawal_id: null, final_amount_cents: { gt: 0 } },
          orderBy: { created_at: 'asc' }
        });
        const availableAmount = available.reduce((sum, item) => sum + item.final_amount_cents, 0);
        if (availableAmount <= 0) throw new Error('暂无可提现开团服务奖励');
        if (amount > availableAmount) throw new Error('提现金额不能超过可提现余额');

        const selected = [] as typeof available;
        let selectedAmount = 0;
        for (const item of available) {
          selected.push(item);
          selectedAmount += item.final_amount_cents;
          if (selectedAmount >= amount) break;
        }
        if (selectedAmount !== amount) throw new Error('第一版仅支持按整笔开团服务奖励提现');

        const created = await tx.withdrawal.create({
          data: {
            leader_user_id: leaderUserId,
            amount_cents: amount,
            status: 'pending',
            taxable_amount_cents: amount,
            tax_amount_cents: 0,
            payable_amount_cents: amount,
            tax_mode: 'pending_review',
            tax_status: 'pending',
            invoice_required: false,
            invoice_status: 'not_required'
          }
        });
        await tx.commission.updateMany({ where: { id: { in: selected.map((item) => item.id) } }, data: { status: 'withdrawing', withdrawal_id: created.id } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_requested',
          withdrawal: created,
          commissionIds: selected.map((item) => item.id),
          orderIds: selected.map((item) => item.order_id),
          after: created
        });
        return created;
      });
      return ok(withdrawal);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '提交提现申请失败');
    }
  });

  app.get('/api/admin/withdrawals', async () => {
    const withdrawals = await prisma.withdrawal.findMany({ orderBy: { created_at: 'desc' } });
    return ok(withdrawals);
  });

  app.get('/api/admin/tax-records', async (request) => {
    const query = request.query as TaxRecordQuery;
    const records = await prisma.taxRecord.findMany({
      where: {
        ...(query.leader_user_id ? { leader_user_id: query.leader_user_id } : {}),
        ...(query.source_type ? { source_type: query.source_type } : {}),
        ...(query.source_id ? { source_id: query.source_id } : {}),
        ...(query.tax_status ? { tax_status: query.tax_status } : {}),
        ...parseDateRange(query)
      },
      orderBy: { created_at: 'desc' },
      take: 200
    });
    return ok(records);
  });

  app.post('/api/admin/withdrawals/:id/reject', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as ReviewBody;
      const rejected = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
        if (!withdrawal) throw new Error('提现申请不存在');
        if (withdrawal.status !== 'pending') throw new Error('当前提现申请不可拒绝');
        const commissions = await tx.commission.findMany({ where: { withdrawal_id: id } });
        const updated = await tx.withdrawal.update({ where: { id }, data: { status: 'rejected', admin_remark: body.reason ?? '人工拒绝' } });
        await tx.commission.updateMany({ where: { withdrawal_id: id }, data: { status: 'available', withdrawal_id: null } });
        await writeAdminAuditLog(tx, request, { action: 'withdrawal_rejected', target_id: id, payload: { reason: body.reason ?? null } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_rejected',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated,
          admin_user_id: request.adminUser?.id ?? null
        });
        return updated;
      });
      return ok(rejected);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '拒绝提现申请失败');
    }
  });

  app.post('/api/admin/withdrawals/:id/tax-review', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as TaxReviewBody;
      const reviewed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
        if (!withdrawal) throw new Error('提现申请不存在');
        if (withdrawal.status !== 'pending' && withdrawal.status !== 'approved') throw new Error('当前提现申请不可做税务复核');
        if (body.tax_mode !== 'none' && body.tax_mode !== 'withheld' && body.tax_mode !== 'invoice') throw new Error('税务处理方式不合法');
        const taxMode = body.tax_mode;
        const taxAmount = Number(body.tax_amount_cents ?? 0);
        if (!Number.isInteger(taxAmount) || taxAmount < 0) throw new Error('税务金额不能小于 0');
        if (taxAmount > withdrawal.amount_cents) throw new Error('税务金额不能超过提现金额');
        const invoiceRequired = taxMode === 'invoice' ? true : body.invoice_required ?? false;
        const invoiceStatus = taxMode === 'invoice'
          ? (body.invoice_status && body.invoice_status !== 'not_required' ? body.invoice_status : 'pending')
          : body.invoice_status ?? 'not_required';
        const taxStatus = resolveTaxStatus({ ...body, tax_mode: taxMode, invoice_status: invoiceStatus });
        const updated = await tx.withdrawal.update({
          where: { id },
          data: {
            tax_mode: taxMode,
            tax_status: taxStatus,
            taxable_amount_cents: withdrawal.amount_cents,
            tax_amount_cents: taxAmount,
            payable_amount_cents: withdrawal.amount_cents - taxAmount,
            tax_rate_basis: body.tax_rate_basis ?? null,
            invoice_required: invoiceRequired,
            invoice_status: invoiceStatus,
            tax_remark: body.tax_remark ?? null
          }
        });
        const taxRecord = await tx.taxRecord.upsert({
          where: { source_type_source_id: { source_type: 'withdrawal', source_id: withdrawal.id } },
          update: {
            leader_user_id: withdrawal.leader_user_id,
            tax_mode: taxMode,
            tax_status: taxStatus,
            amount_cents: withdrawal.amount_cents,
            payload: {
              taxable_amount_cents: withdrawal.amount_cents,
              tax_amount_cents: taxAmount,
              payable_amount_cents: withdrawal.amount_cents - taxAmount,
              tax_rate_basis: body.tax_rate_basis ?? null,
              invoice_required: invoiceRequired,
              invoice_status: invoiceStatus,
              tax_remark: body.tax_remark ?? null
            }
          },
          create: {
            leader_user_id: withdrawal.leader_user_id,
            source_type: 'withdrawal',
            source_id: withdrawal.id,
            tax_mode: taxMode,
            tax_status: taxStatus,
            amount_cents: withdrawal.amount_cents,
            payload: {
              taxable_amount_cents: withdrawal.amount_cents,
              tax_amount_cents: taxAmount,
              payable_amount_cents: withdrawal.amount_cents - taxAmount,
              tax_rate_basis: body.tax_rate_basis ?? null,
              invoice_required: invoiceRequired,
              invoice_status: invoiceStatus,
              tax_remark: body.tax_remark ?? null
            }
          }
        });
        const commissions = await tx.commission.findMany({ where: { withdrawal_id: id } });
        await writeAdminAuditLog(tx, request, { action: 'withdrawal_tax_reviewed', target_id: id, payload: { tax_mode: taxMode, tax_status: taxStatus, tax_amount_cents: taxAmount } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_tax_reviewed',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated,
          admin_user_id: request.adminUser?.id ?? null,
          extraPayload: {
            tax_record_id: taxRecord.id,
            tax_mode: taxMode,
            tax_status: taxStatus,
            tax_amount_cents: taxAmount,
            payable_amount_cents: withdrawal.amount_cents - taxAmount,
            invoice_required: invoiceRequired,
            invoice_status: invoiceStatus
          }
        });
        return { withdrawal: updated, tax_record: taxRecord };
      });
      return ok(reviewed);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '提现税务复核失败');
    }
  });

  app.post('/api/admin/withdrawals/:id/approve', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as ReviewBody;
      const approved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
        if (!withdrawal) throw new Error('提现申请不存在');
        if (withdrawal.status !== 'pending') throw new Error('当前提现申请不可审核通过');
        const commissions = await tx.commission.findMany({ where: { withdrawal_id: id } });
        const updated = await tx.withdrawal.update({ where: { id }, data: { status: 'approved', admin_remark: body.reason ?? '人工审核通过' } });
        await writeAdminAuditLog(tx, request, { action: 'withdrawal_approved', target_id: id, payload: { reason: body.reason ?? null } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_approved',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated,
          admin_user_id: request.adminUser?.id ?? null
        });
        return updated;
      });
      return ok(approved);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '审核提现申请失败');
    }
  });

  app.post('/api/admin/withdrawals/:id/mark-paid', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as ReviewBody;
      const paid = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const withdrawal = await tx.withdrawal.findUnique({ where: { id } });
        if (!withdrawal) throw new Error('提现申请不存在');
        if (withdrawal.status !== 'approved') throw new Error('仅审核通过的提现申请可标记已处理');
        if (withdrawal.tax_status === 'pending') throw new Error('提现税务状态待复核，不能标记已处理');
        if (withdrawal.payable_amount_cents < 0) throw new Error('可处理金额不能小于 0');
        if (withdrawal.invoice_required && withdrawal.invoice_status !== 'verified') throw new Error('发票状态未确认，不能标记已处理');
        const commissions = await tx.commission.findMany({ where: { withdrawal_id: id } });
        const updated = await tx.withdrawal.update({ where: { id }, data: { status: 'paid', admin_remark: body.reason ?? withdrawal.admin_remark } });
        await tx.commission.updateMany({ where: { withdrawal_id: id }, data: { status: 'withdrawn' } });
        await writeAdminAuditLog(tx, request, { action: 'withdrawal_mark_paid', target_id: id, payload: { tax_status: updated.tax_status, payable_amount_cents: updated.payable_amount_cents } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_mark_paid',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated,
          admin_user_id: request.adminUser?.id ?? null
        });
        return updated;
      });
      return ok(paid);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '标记提现处理失败');
    }
  });
}
