import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { backfillAvailableRewardLedgers, getAvailableRewardBalance, releaseDueCommissions, toLeaderCommissionDto, appendRewardLedgerEntry } from '../services/commission-service.js';
import { safeRecordBusinessEvent } from '../services/logging-service.js';
import { ADMIN_SCOPE_FORBIDDEN, canAccessCommunity, canAccessOrderDataScope, hasAllCommunityScope, hasAllPickupStoreScope, requireAdminPermission, resolveAdminAccessContext } from '../modules/admin-access/admin-access-control.js';

async function resolveLeaderId(request: { headers: Record<string, unknown>; query: unknown }) {
  const query = request.query as { leader_user_id?: string; openid?: string };
  const openid = typeof request.headers['x-openid'] === 'string' ? request.headers['x-openid'] : query.openid;
  if (!openid) throw Object.assign(new Error('缺少开团人身份'), { statusCode: 401 });
  const user = await prisma.user.findUnique({ where: { openid } });
  if (!user || user.role !== 'leader') throw Object.assign(new Error('开团人不存在'), { statusCode: 401 });
  if (query.leader_user_id && query.leader_user_id !== user.id) throw Object.assign(new Error('禁止查看其他开团人的开团服务奖励'), { statusCode: 403 });
  return user.id;
}

function scopeWhere(context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>) {
  if (context.is_super_admin || hasAllCommunityScope(context) || hasAllPickupStoreScope(context)) return {};
  const or: Record<string, unknown>[] = [];
  if (context.data_scope.community_ids.length) or.push({ group_buy: { community_id: { in: context.data_scope.community_ids } } }, { order: { community_id: { in: context.data_scope.community_ids } } });
  if (context.data_scope.pickup_store_ids.length) or.push({ order: { pickup_store_id: { in: context.data_scope.pickup_store_ids } } });
  return or.length ? { OR: or } : null;
}

async function requireCommissionScope(id: string, context: NonNullable<ReturnType<typeof resolveAdminAccessContext>>) {
  const c = await prisma.commission.findUnique({ where: { id }, include: { order: true, group_buy: true } });
  if (!c) throw Object.assign(new Error('开团服务奖励记录不存在'), { statusCode: 404 });
  if (!context.is_super_admin && !canAccessCommunity(context, c.group_buy.community_id) && !canAccessOrderDataScope(context, c.order)) throw Object.assign(new Error(ADMIN_SCOPE_FORBIDDEN), { statusCode: 403 });
  return c;
}


function requireGlobalRewardOperationAccess(request: FastifyRequest, reply: FastifyReply) {
  const context = resolveAdminAccessContext(request);
  if (!context) {
    reply.code(401);
    return null;
  }
  if (!context.is_super_admin) {
    reply.code(403);
    return null;
  }
  return context;
}

function adminDto(c: Awaited<ReturnType<typeof requireCommissionScope>>, ledgerCount = 0) {
  return { leader_user_id: c.leader_user_id, commission_id: c.id, order_id: c.order_id, order_no: c.order.order_no, group_buy_id: c.group_buy_id, community_id: c.group_buy.community_id, community_name: '', product_amount_cents: c.order.product_amount_cents ?? c.order.total_amount_cents, product_refund_amount_cents: c.order.product_refund_amount_cents, estimated_amount_cents: c.estimated_amount_cents, deduct_amount_cents: c.deduct_amount_cents, final_amount_cents: c.final_amount_cents, status: c.status, available_at: c.available_at, review_status: c.review_status, review_note: c.review_note, reviewed_at: c.reviewed_at, ledger_summary: { ledger_count: ledgerCount } };
}

export function registerCommissionRoutes(app: FastifyInstance) {
  app.get('/api/leaders/me/commissions', async (request, reply) => {
    try {
      const leaderUserId = await resolveLeaderId(request);
      const commissions = await prisma.commission.findMany({ where: { leader_user_id: leaderUserId }, include: { order: { select: { order_no: true } }, group_buy: { include: { product: { select: { name: true } }, community: { select: { name: true } } } } }, orderBy: { created_at: 'desc' } });
      const balance = await prisma.$transaction((tx) => getAvailableRewardBalance(tx, leaderUserId));
      const summary = commissions.reduce((acc, item) => { if (item.status === 'estimated') acc.estimated_amount_cents += item.final_amount_cents; if (item.status === 'pending') acc.pending_amount_cents += item.final_amount_cents; if (item.status === 'cancelled') acc.cancelled_amount_cents += item.estimated_amount_cents; if (item.status === 'converted') acc.converted_amount_cents += item.final_amount_cents; if (item.status === 'withdrawn') acc.withdrawn_amount_cents += item.final_amount_cents; acc.deducted_amount_cents += item.deduct_amount_cents; if (item.status === 'frozen' || item.status === 'withdrawing') acc.locked_amount_cents += item.final_amount_cents; return acc; }, { estimated_amount_cents: 0, pending_amount_cents: 0, available_amount_cents: Math.max(0, balance), withdrawable_amount_cents: Math.max(0, balance), deducted_amount_cents: 0, cancelled_amount_cents: 0, locked_amount_cents: 0, converted_amount_cents: 0, withdrawn_amount_cents: 0 });
      return ok({ summary, items: commissions.map(toLeaderCommissionDto) });
    } catch (error) { reply.code((error as { statusCode?: number }).statusCode ?? 400); return fail(error instanceof Error ? error.message : '查询开团服务奖励失败'); }
  });

  app.get('/api/admin/rewards', { preHandler: requireAdminPermission('reward.view') }, async (request, reply) => {
    const context = resolveAdminAccessContext(request)!; const sw = scopeWhere(context); if (sw === null) { reply.code(403); return fail(ADMIN_SCOPE_FORBIDDEN); }
    const q = request.query as { status?: string; review_status?: string; leader_user_id?: string; order_no?: string; group_buy_id?: string; community_id?: string; page?: string; page_size?: string };
    const where: Record<string, unknown> = { ...sw };
    if (q.status) where.status = q.status; if (q.review_status) where.review_status = q.review_status; if (q.leader_user_id) where.leader_user_id = q.leader_user_id; if (q.group_buy_id) where.group_buy_id = q.group_buy_id; if (q.community_id) where.group_buy = { community_id: q.community_id }; if (q.order_no) where.order = { order_no: { contains: q.order_no } };
    const page = Math.max(1, Number(q.page ?? 1)); const take = Math.min(100, Math.max(1, Number(q.page_size ?? 20)));
    const items = await prisma.commission.findMany({ where, include: { order: true, group_buy: true }, skip: (page - 1) * take, take, orderBy: { created_at: 'desc' } });
    return ok({ items: items.map((x) => adminDto(x, 0)), page, page_size: take });
  });
  app.get('/api/admin/rewards/:id', { preHandler: requireAdminPermission('reward.view') }, async (request, reply) => { try { const c = await requireCommissionScope((request.params as { id: string }).id, resolveAdminAccessContext(request)!); const n = await prisma.rewardLedger.count({ where: { commission_id: c.id } }); return ok(adminDto(c, n)); } catch (e) { reply.code((e as { statusCode?: number }).statusCode ?? 400); return fail(e instanceof Error ? e.message : '查询失败'); } });
  app.post('/api/admin/rewards/release-due', { preHandler: requireAdminPermission('reward.manage') }, async (request, reply) => { const context = requireGlobalRewardOperationAccess(request, reply); if (!context) return fail(reply.statusCode === 403 ? ADMIN_SCOPE_FORBIDDEN : 'ADMIN_UNAUTHORIZED: Admin identity required'); return ok(await releaseDueCommissions()); });
  app.post('/api/admin/commissions/settle', { preHandler: requireAdminPermission('reward.manage') }, async (request, reply) => { const context = requireGlobalRewardOperationAccess(request, reply); if (!context) return fail(reply.statusCode === 403 ? ADMIN_SCOPE_FORBIDDEN : 'ADMIN_UNAUTHORIZED: Admin identity required'); return ok(await releaseDueCommissions()); });
  app.post('/api/admin/rewards/:id/review', { preHandler: requireAdminPermission('reward.manage') }, async (request, reply) => { try { const id = (request.params as { id: string }).id; const body = request.body as { review_status?: string; review_note?: string }; if (body.review_status !== 'verified' && body.review_status !== 'needs_follow_up') throw new Error('核对状态无效'); if (body.review_status === 'needs_follow_up' && !body.review_note) throw new Error('待跟进必须填写备注'); const before = await requireCommissionScope(id, resolveAdminAccessContext(request)!); const updated = await prisma.commission.update({ where: { id }, data: { review_status: body.review_status, review_note: body.review_note ?? null, reviewed_by_admin_id: resolveAdminAccessContext(request)!.admin_user_id, reviewed_at: new Date() } }); await prisma.adminAuditLog.create({ data: { admin_user_id: resolveAdminAccessContext(request)!.admin_user_id, action: 'reward_reviewed', target_type: 'Commission', target_id: id, payload: { review_status: updated.review_status } } }); await safeRecordBusinessEvent(prisma, { event_type: 'commission_reviewed', event_source: 'commissions-route', commission_id: id, order_id: before.order_id, leader_user_id: before.leader_user_id }); return ok({ commission_id: updated.id, review_status: updated.review_status, review_note: updated.review_note, reviewed_at: updated.reviewed_at }); } catch (e) { reply.code((e as { statusCode?: number }).statusCode ?? 400); return fail(e instanceof Error ? e.message : '核对失败'); } });
  app.get('/api/admin/commissions', { preHandler: requireAdminPermission('reward.view') }, async (request, reply) => app.inject({ method: 'GET', url: '/api/admin/rewards', headers: request.headers as Record<string,string> }).then((r) => { reply.code(r.statusCode); return JSON.parse(r.body); }));
  for (const action of ['freeze', 'unfreeze'] as const) app.post(`/api/admin/commissions/:id/${action}`, { preHandler: requireAdminPermission('reward.manage') }, async (request, reply) => { try { const c = await requireCommissionScope((request.params as { id: string }).id, resolveAdminAccessContext(request)!); const next = action === 'freeze' ? 'frozen' : (c.available_at && c.available_at <= new Date() ? 'available' : 'pending'); if (action === 'unfreeze' && c.status !== 'frozen') return ok(adminDto(c, 0)); if (action === 'freeze' && c.status === 'frozen') return ok(adminDto(c, 0)); const updated = await prisma.commission.update({ where: { id: c.id }, data: { status: next } }); if (next === 'available') await prisma.$transaction((tx) => appendRewardLedgerEntry(tx, { leader_user_id: c.leader_user_id, commission_id: c.id, order_id: c.order_id, event_type: 'commission_available', entry_type: 'commission_available', direction: 'in', amount_cents: c.final_amount_cents, affects_available_balance: true, idempotency_key: `commission-available:${c.id}` })); await safeRecordBusinessEvent(prisma, { event_type: `commission_${action}d`, event_source: 'commissions-route', commission_id: c.id, order_id: c.order_id }); return ok(adminDto({ ...c, ...updated }, 0)); } catch (e) { reply.code((e as { statusCode?: number }).statusCode ?? 400); return fail(e instanceof Error ? e.message : '操作失败'); } });
  app.post('/api/admin/rewards/backfill', { preHandler: requireAdminPermission('reward.manage') }, async (request, reply) => { const context = requireGlobalRewardOperationAccess(request, reply); if (!context) return fail(reply.statusCode === 403 ? ADMIN_SCOPE_FORBIDDEN : 'ADMIN_UNAUTHORIZED: Admin identity required'); return ok(await backfillAvailableRewardLedgers()); });
}
