import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { releaseAvailableCommissions } from '../services/commission-service.js';
import { safeRecordBusinessEvent } from '../services/logging-service.js';

type LeaderQuery = {
  leader_user_id?: string;
  openid?: string;
};

async function resolveLeaderId(query: LeaderQuery) {
  if (query.leader_user_id) return query.leader_user_id;
  if (!query.openid) throw new Error('缺少开团人标识');
  const user = await prisma.user.findUnique({ where: { openid: query.openid } });
  if (!user || user.role !== 'leader') throw new Error('开团人不存在');
  return user.id;
}

export function registerCommissionRoutes(app: FastifyInstance) {
  app.get('/api/leaders/me/commissions', async (request, reply) => {
    try {
      const leaderUserId = await resolveLeaderId(request.query as LeaderQuery);
      const commissions = await prisma.commission.findMany({
        where: { leader_user_id: leaderUserId },
        include: { order: true, group_buy: { include: { product: true, community: true } } },
        orderBy: { created_at: 'desc' }
      });
      const summary = commissions.reduce(
        (acc, item) => {
          acc.total_amount_cents += item.final_amount_cents;
          if (item.status === 'available') acc.available_amount_cents += item.final_amount_cents;
          if (item.status === 'pending') acc.pending_amount_cents += item.final_amount_cents;
          if (item.status === 'estimated') acc.estimated_amount_cents += item.final_amount_cents;
          return acc;
        },
        { total_amount_cents: 0, available_amount_cents: 0, pending_amount_cents: 0, estimated_amount_cents: 0 }
      );
      return ok({ summary, commissions });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '查询开团服务奖励失败');
    }
  });

  app.get('/api/admin/commissions', async () => {
    const commissions = await prisma.commission.findMany({
      include: { leader_user: true, order: true, group_buy: { include: { product: true, community: true } } },
      orderBy: { created_at: 'desc' }
    });
    return ok(commissions);
  });

  app.post('/api/admin/commissions/settle', async () => {
    const result = await releaseAvailableCommissions();
    return ok(result);
  });

  app.post('/api/admin/commissions/:id/freeze', async (request, reply) => {
    const { id } = request.params as { id: string };
    const commission = await prisma.commission.findUnique({ where: { id } });
    if (!commission) {
      reply.code(404);
      return fail('开团服务奖励记录不存在');
    }
    if (commission.status === 'withdrawn' || commission.status === 'cancelled') {
      reply.code(400);
      return fail('当前开团服务奖励状态不可冻结');
    }
    const updated = await prisma.commission.update({ where: { id }, data: { status: 'frozen' } });
    await safeRecordBusinessEvent(prisma, {
      event_type: 'commission_frozen',
      event_source: 'commissions-route',
      order_id: commission.order_id,
      group_buy_id: commission.group_buy_id,
      commission_id: commission.id,
      leader_user_id: commission.leader_user_id,
      before_snapshot: commission,
      after_snapshot: updated
    });
    return ok(updated);
  });

  app.post('/api/admin/commissions/:id/unfreeze', async (request, reply) => {
    const { id } = request.params as { id: string };
    const commission = await prisma.commission.findUnique({ where: { id } });
    if (!commission) {
      reply.code(404);
      return fail('开团服务奖励记录不存在');
    }
    if (commission.status !== 'frozen') {
      reply.code(400);
      return fail('当前开团服务奖励状态不可解冻');
    }
    const nextStatus = commission.available_at && commission.available_at <= new Date() ? 'available' : 'pending';
    const updated = await prisma.commission.update({ where: { id }, data: { status: nextStatus } });
    await safeRecordBusinessEvent(prisma, {
      event_type: 'commission_unfrozen',
      event_source: 'commissions-route',
      order_id: commission.order_id,
      group_buy_id: commission.group_buy_id,
      commission_id: commission.id,
      leader_user_id: commission.leader_user_id,
      before_snapshot: commission,
      after_snapshot: updated
    });
    return ok(updated);
  });
}
