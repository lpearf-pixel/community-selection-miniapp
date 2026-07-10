import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import {
  addAfterSaleNote,
  cancelAfterSaleCase,
  createAfterSaleCase,
  linkAfterSaleLoss,
  resolveAfterSaleCase,
  reviewAfterSaleCase
} from '../modules/after-sale/after-sale-service.js';

type PublicListQuery = { order_id?: string; status?: string; type?: string; user_id?: string };
type AdminListQuery = { status?: string; type?: string; responsibility?: string; order_id?: string; group_buy_id?: string; product_id?: string };

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
  app.get('/api/admin/after-sales', async (request) => {
    const query = request.query as AdminListQuery;
    const cases = await prisma.afterSaleCase.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.responsibility ? { responsibility: query.responsibility } : {}),
        ...(query.order_id ? { order_id: query.order_id } : {}),
        ...(query.group_buy_id ? { group_buy_id: query.group_buy_id } : {}),
        ...(query.product_id ? { product_id: query.product_id } : {})
      },
      include: { order: true, product: true, logs: { orderBy: { created_at: 'asc' } } },
      orderBy: { created_at: 'desc' },
      take: 200
    });
    return ok(cases);
  });

  app.get('/api/admin/after-sales/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const afterSaleCase = await prisma.afterSaleCase.findUnique({ where: { id }, include: includeDetail() });
    if (!afterSaleCase) {
      reply.code(404);
      return fail('售后工单不存在');
    }
    return ok(afterSaleCase);
  });

  app.post('/api/admin/after-sales/:id/review', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as ReviewAfterSaleBody;
      return ok(await reviewAfterSaleCase(id, { ...body, status: body.status ?? '', admin_user_id: request.adminUser?.id ?? null }));
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '售后审核失败');
    }
  });

  app.post('/api/admin/after-sales/:id/resolve', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as ResolveAfterSaleBody;
      return ok(await resolveAfterSaleCase(id, { ...body, resolution_type: body.resolution_type ?? '', admin_user_id: request.adminUser?.id ?? null }));
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
