import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from '../services/logging-service.js';

type LeaderQuery = { leader_user_id?: string; openid?: string };
type WithdrawBody = { leader_user_id?: string; openid?: string; amount_cents?: number };
type ReviewBody = { admin_user_id?: string; reason?: string };

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

async function logWithdrawalEvent(tx: Prisma.TransactionClient, input: {
  event_type: string;
  withdrawal: { id: string; leader_user_id: string; amount_cents: number; status: string };
  commissionIds?: string[];
  orderIds?: string[];
  before?: unknown;
  after?: unknown;
  message?: string;
}) {
  await safeRecordBusinessEvent(tx, {
    event_type: input.event_type,
    event_source: 'withdrawals-route',
    withdrawal_id: input.withdrawal.id,
    leader_user_id: input.withdrawal.leader_user_id,
    before_snapshot: input.before,
    after_snapshot: input.after ?? input.withdrawal,
    payload: { amount_cents: input.withdrawal.amount_cents, commission_ids: input.commissionIds ?? [] },
    message: input.message ?? null
  });
  for (const orderId of input.orderIds ?? []) {
    await safeRecordOrderTimeline(tx, {
      order_id: orderId,
      event_type: input.event_type,
      title: input.event_type === 'withdrawal_requested' ? '开团服务奖励提现申请已提交' : '开团服务奖励提现状态已更新',
      payload: { withdrawal_id: input.withdrawal.id, amount_cents: input.withdrawal.amount_cents, status: input.withdrawal.status }
    });
  }
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

        const created = await tx.withdrawal.create({ data: { leader_user_id: leaderUserId, amount_cents: amount, status: 'pending' } });
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
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_rejected',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated
        });
        return updated;
      });
      return ok(rejected);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '拒绝提现申请失败');
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
        await tx.commission.updateMany({ where: { withdrawal_id: id }, data: { status: 'withdrawn' } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_approved',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated
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
        const commissions = await tx.commission.findMany({ where: { withdrawal_id: id } });
        const updated = await tx.withdrawal.update({ where: { id }, data: { status: 'paid', admin_remark: body.reason ?? withdrawal.admin_remark } });
        await logWithdrawalEvent(tx, {
          event_type: 'withdrawal_mark_paid',
          withdrawal: updated,
          commissionIds: commissions.map((item) => item.id),
          orderIds: commissions.map((item) => item.order_id),
          before: withdrawal,
          after: updated
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
