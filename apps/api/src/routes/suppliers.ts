import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { createSupplier, disableSupplier, listSuppliers, updateSupplier } from '../modules/supplier/supplier-service.js';

type SupplierBody = {
  name?: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  license_no?: string | null;
  certification_info?: unknown;
  remark?: string | null;
};

function requireAdmin(request: { adminUser?: { id: string } }) {
  if (!request.adminUser?.id) throw new Error('后台登录已失效');
  return request.adminUser.id;
}

function adminMeta(request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }) {
  return {
    admin_user_id: requireAdmin(request),
    ip_address: request.ip ?? null,
    user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null
  };
}

export function registerSupplierRoutes(app: FastifyInstance) {
  app.get('/api/admin/suppliers', async (request, reply) => {
    try {
      requireAdmin(request);
      return ok(await listSuppliers(request.query as { status?: string }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询供应商失败');
    }
  });

  app.post('/api/admin/suppliers', async (request, reply) => {
    try {
      return ok(await createSupplier({ body: request.body as SupplierBody, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '创建供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/update', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await updateSupplier({ id, body: request.body as SupplierBody, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '更新供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/disable', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await disableSupplier({ id, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '禁用供应商失败');
    }
  });
}
