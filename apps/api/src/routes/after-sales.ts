import type { FastifyInstance } from 'fastify';
import { contractFail, contractOk, fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { ADMIN_SCOPE_FORBIDDEN, canAccessOrderDataScope, getScopedOrderWhere, hasAdminPermission, requireAdminPermission, requireAdminPermissionV1, resolveAdminAccessContext } from '../modules/admin-access/admin-access-control.js';
import { parseAdminRefundCommand } from '../modules/refund/admin-refund-command.js';
import { AdminRefundCommandError, executeAdminRefundCommand } from '../modules/refund/admin-refund-executor.js';
import {
  addAfterSaleNote,
  cancelAfterSaleCase,
  createAfterSaleCase,
  linkAfterSaleLoss,
  resolveAfterSaleCase,
  reviewAfterSaleCase
} from '../modules/after-sale/after-sale-service.js';

type PublicListQuery = { order_id?: string; status?: string; type?: string; user_id?: string };
type AdminListQuery = { status?: string; type?: string; responsibility?: string; order_id?: string; order_no?: string; group_buy_id?: string; product_id?: string };

type CreateAfterSaleBody = {
  order_id?: string;
  user_id?: string;
  product_id?: string;
  type?: string;
  reason?: string;
  description?: string;
  requested_refund_cents?: number;
  requested_product_refund_cents?: number;
  requested_delivery_refund_cents?: number;
  evidence_image_urls?: string[];
};

type ReviewAfterSaleBody = {
  status?: string;
  approved_refund_cents?: number;
  approved_product_refund_cents?: number;
  approved_delivery_refund_cents?: number;
  resolution_type?: string;
  responsibility?: string;
  admin_note?: string;
};

type ResolveAfterSaleBody = {
  resolution_type?: string;
  approved_refund_cents?: number;
  approved_product_refund_cents?: number;
  approved_delivery_refund_cents?: number;
  admin_note?: string;
};

type NoteBody = { admin_note?: string; note?: string };
type LinkLossBody = { product_id?: string; batch_id?: string; quantity?: number; reason?: string; remark?: string };

function includeDetail() {
  return { logs: { orderBy: { created_at: 'asc' as const } }, order: true, product: true };
}
function includeAdminDetail() {
  return { logs: { orderBy: { created_at: 'asc' as const } }, order: true, product: true, reviewed_by_admin: true };
}

function maskPhone(phone?: string | null) { return phone ? phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : null; }
function maskAddress(address?: string | null) { return address ? `${address.slice(0, 6)}***` : null; }
function toAdminAfterSale(item: any) {
  const order = item.order;
  return {
    id: item.id, after_sale_case_id: item.id, order_id: item.order_id, order_no: order?.order_no ?? null, type: item.type, status: item.status, resolution_type: item.resolution_type, reason: item.reason, description: item.description,
    requested_refund_cents: item.requested_refund_cents ?? 0, requested_product_refund_cents: item.requested_product_refund_cents ?? 0, requested_delivery_refund_cents: item.requested_delivery_refund_cents ?? 0,
    approved_refund_cents: item.approved_refund_cents ?? 0, approved_product_refund_cents: item.approved_product_refund_cents ?? 0, approved_delivery_refund_cents: item.approved_delivery_refund_cents ?? 0,
    responsibility: item.responsibility, admin_note: item.admin_note, reviewed_at: item.reviewed_at, resolved_at: item.resolved_at, created_at: item.created_at,
    handler: item.reviewed_by_admin ? { id: item.reviewed_by_admin.id, username: item.reviewed_by_admin.username } : null,
    order: order ? { order_id: order.id, order_no: order.order_no, version: order.version, product_amount_cents: order.product_amount_cents ?? order.total_amount_cents, delivery_fee_cents: order.delivery_fee_cents ?? 0, pay_amount_cents: order.pay_amount_cents, refund_amount_cents: order.refund_amount_cents, product_refund_amount_cents: order.product_refund_amount_cents, delivery_refund_amount_cents: order.delivery_refund_amount_cents, remaining_refundable_amount_cents: Math.max(0, order.pay_amount_cents - order.refund_amount_cents), pickup_type: order.pickup_type, pickup_store_id: order.pickup_store_id, community_id: order.community_id, receiver_name: order.receiver_name, receiver_phone_masked: maskPhone(order.receiver_phone), receiver_address_masked: maskAddress(order.receiver_address), pay_status: order.pay_status, order_status: order.order_status } : null,
    product: item.product ? { product_id: item.product.id, name: item.product.name, price_cents: item.product.price_cents } : null,
    logs: (item.logs ?? []).map((log: any) => ({ id: log.id, action: log.action, actor_type: log.actor_type, actor_id: log.actor_id, note: log.note, created_at: log.created_at }))
  };
}

async function ensureAfterSaleScope(request: any, id: string, reply: any) {
  const context = resolveAdminAccessContext(request);
  if (!context) { reply.code(401); return null; }
  const item = await prisma.afterSaleCase.findUnique({ where: { id }, include: { order: true } });
  if (!item) { reply.code(404); return null; }
  if (!canAccessOrderDataScope(context, item.order)) { reply.code(403); return null; }
  return item;
}

export function registerPublicAfterSaleRoutes(app: FastifyInstance) {
  app.post('/api/after-sales', async (request, reply) => {
    try {
      const body = request.body as CreateAfterSaleBody;
      if (!body.order_id || !body.type || !body.reason) throw new Error('缺少售后必填字段');
      return ok(await createAfterSaleCase({
        order_id: body.order_id,
        user_id: body.user_id ?? null,
        product_id: body.product_id ?? null,
        type: body.type,
        reason: body.reason,
        description: body.description ?? null,
        requested_refund_cents: body.requested_refund_cents ?? null,
        requested_product_refund_cents: body.requested_product_refund_cents ?? null,
        requested_delivery_refund_cents: body.requested_delivery_refund_cents ?? null,
        evidence_image_urls: body.evidence_image_urls ?? null
      }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '提交售后失败');
    }
  });

  app.get('/api/after-sales', async (request) => {
    const query = request.query as PublicListQuery;
    const cases = await prisma.afterSaleCase.findMany({
      where: {
        ...(query.order_id ? { order_id: query.order_id } : {}),
        ...(query.user_id ? { user_id: query.user_id } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {})
      },
      include: { order: true, product: true },
      orderBy: { created_at: 'desc' },
      take: 200
    });
    return ok(cases);
  });

  app.get('/api/after-sales/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const afterSaleCase = await prisma.afterSaleCase.findUnique({ where: { id }, include: includeDetail() });
    if (!afterSaleCase) {
      reply.code(404);
      return fail('售后工单不存在');
    }
    return ok(afterSaleCase);
  });

  app.post('/api/after-sales/:id/cancel', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await cancelAfterSaleCase(id, { actor_type: 'user' }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '取消售后失败');
    }
  });
}

export function registerAdminAfterSaleRoutes(app: FastifyInstance) {
  app.post(
    '/api/admin/after-sales/:id/refund-execute',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1([
        'after_sale.manage',
        'refund.manage',
      ]),
    },
    async (request, reply) => {
      const traceId = String(request.id);
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return contractFail({
          code: 'ADMIN_UNAUTHORIZED',
          message: '管理员身份无效',
          traceId,
        });
      }
      if (
        !['after_sale.manage', 'refund.manage'].every((permission) =>
          hasAdminPermission(context, permission as 'after_sale.manage' | 'refund.manage'),
        )
      ) {
        reply.code(403);
        return contractFail({
          code: 'ADMIN_FORBIDDEN',
          message: '当前管理员无此操作权限',
          traceId,
        });
      }
      const parsed = parseAdminRefundCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }
      const { id } = request.params as { id: string };
      try {
        const result = await executeAdminRefundCommand({
          after_sale_case_id: id,
          command: parsed.value,
          context,
          admin_meta: {
            ip_address: request.ip,
            user_agent:
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : null,
          },
        });
        return contractOk(result, {
          code: 'ADMIN_REFUND_EXECUTED',
          message: '退款执行成功',
          traceId,
        });
      } catch (error) {
        if (error instanceof AdminRefundCommandError) {
          reply.code(error.statusCode);
          return contractFail({
            code: error.code,
            message: error.message,
            traceId,
          });
        }
        request.log.error(
          {
            error_name: error instanceof Error ? error.name : 'UnknownError',
            after_sale_case_id: id,
            trace_id: traceId,
          },
          'Admin refund execution failed',
        );
        reply.code(500);
        return contractFail({
          code: 'ADMIN_REFUND_EXECUTION_FAILED',
          message: '退款执行失败',
          traceId,
        });
      }
    },
  );

  app.get('/api/admin/after-sales', { preHandler: requireAdminPermission('after_sale.manage') }, async (request, reply) => {
    const query = request.query as AdminListQuery;
    const context = resolveAdminAccessContext(request);
    const scopedOrderWhere = context ? getScopedOrderWhere(context) : null;
    if (!context) { reply.code(401); return fail('ADMIN_UNAUTHORIZED: Admin identity required'); }
    if (scopedOrderWhere === null) return ok([]);
    const cases = await prisma.afterSaleCase.findMany({
      where: {
        order: { ...(scopedOrderWhere as any), ...(query.order_no ? { order_no: { contains: query.order_no } } : {}) },
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.responsibility ? { responsibility: query.responsibility } : {}),
        ...(query.order_id ? { order_id: query.order_id } : {}),
        ...(query.group_buy_id ? { group_buy_id: query.group_buy_id } : {}),
        ...(query.product_id ? { product_id: query.product_id } : {})
      },
      include: { order: true, product: true, reviewed_by_admin: true, logs: { orderBy: { created_at: 'asc' } } },
      orderBy: { created_at: 'desc' },
      take: 200
    });
    return ok(cases.map(toAdminAfterSale));
  });

  app.get('/api/admin/after-sales/:id', { preHandler: requireAdminPermission('after_sale.manage') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const scoped = await ensureAfterSaleScope(request, id, reply);
    if (!scoped) return fail(reply.statusCode === 403 ? ADMIN_SCOPE_FORBIDDEN : '售后工单不存在');
    const afterSaleCase = await prisma.afterSaleCase.findUnique({ where: { id }, include: includeAdminDetail() });
    return ok(toAdminAfterSale(afterSaleCase));
  });

  app.post('/api/admin/after-sales/:id/review', { preHandler: requireAdminPermission(['after_sale.manage', 'refund.manage']) }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const scoped = await ensureAfterSaleScope(request, id, reply);
      if (!scoped) return fail(reply.statusCode === 403 ? ADMIN_SCOPE_FORBIDDEN : '售后工单不存在');
      const body = request.body as ReviewAfterSaleBody;
      const context = resolveAdminAccessContext(request);
      return ok(toAdminAfterSale(await prisma.afterSaleCase.findUniqueOrThrow({ where: { id: (await reviewAfterSaleCase(id, { ...body, status: body.status ?? '', admin_user_id: context?.admin_user_id ?? request.adminUser?.id ?? null })).id }, include: includeAdminDetail() })));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '售后审核失败');
    }
  });

  app.post('/api/admin/after-sales/:id/resolve', { preHandler: requireAdminPermission(['after_sale.manage', 'refund.manage']) }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const scoped = await ensureAfterSaleScope(request, id, reply);
      if (!scoped) return fail(reply.statusCode === 403 ? ADMIN_SCOPE_FORBIDDEN : '售后工单不存在');
      const body = request.body as ResolveAfterSaleBody;
      const context = resolveAdminAccessContext(request);
      return ok(await resolveAfterSaleCase(id, { ...body, resolution_type: body.resolution_type ?? '', admin_user_id: context?.admin_user_id ?? request.adminUser?.id ?? null }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '售后解决失败');
    }
  });

  app.post('/api/admin/after-sales/:id/add-note', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as NoteBody;
      const note = body.admin_note ?? body.note;
      if (!note) throw new Error('缺少售后备注');
      return ok(await addAfterSaleNote(id, { admin_note: note, admin_user_id: request.adminUser?.id ?? null }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '追加售后备注失败');
    }
  });

  app.post('/api/admin/after-sales/:id/link-loss', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as LinkLossBody;
      if (!body.product_id || !body.quantity || !body.reason) throw new Error('缺少损耗必填字段');
      return ok(await linkAfterSaleLoss(id, {
        product_id: body.product_id,
        batch_id: body.batch_id ?? null,
        quantity: body.quantity,
        reason: body.reason,
        remark: body.remark ?? null,
        admin_user_id: request.adminUser?.id ?? null
      }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '关联售后损耗失败');
    }
  });
}
