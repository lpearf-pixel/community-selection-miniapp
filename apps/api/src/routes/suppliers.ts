import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

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

async function writeAdminAuditLog(tx: Prisma.TransactionClient, request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }, input: { action: string; target_type: string; target_id: string; payload?: unknown }) {
  await tx.adminAuditLog.create({
    data: {
      admin_user_id: request.adminUser?.id ?? null,
      action: input.action,
      target_type: input.target_type,
      target_id: input.target_id,
      ip_address: request.ip ?? null,
      user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      payload: input.payload === undefined ? Prisma.JsonNull : input.payload as Prisma.InputJsonValue
    }
  });
}

function supplierData(body: SupplierBody, partial = false) {
  const data: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    const name = body.name?.trim();
    if (!name) throw new Error('供应商名称不能为空');
    data.name = name;
  }
  for (const key of ['contact_name', 'contact_phone', 'address', 'license_no', 'remark'] as const) {
    if (!partial || body[key] !== undefined) data[key] = body[key]?.trim() || null;
  }
  if (!partial || body.certification_info !== undefined) data.certification_info = body.certification_info === undefined ? Prisma.JsonNull : body.certification_info as Prisma.InputJsonValue;
  return data;
}

export function registerSupplierRoutes(app: FastifyInstance) {
  app.get('/api/admin/suppliers', async (request, reply) => {
    try {
      requireAdmin(request);
      const query = request.query as { status?: string };
      const suppliers = await prisma.supplier.findMany({
        where: { ...(query.status ? { status: query.status } : {}) },
        orderBy: { created_at: 'desc' }
      });
      return ok(suppliers);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询供应商失败');
    }
  });

  app.post('/api/admin/suppliers', async (request, reply) => {
    try {
      requireAdmin(request);
      const body = request.body as SupplierBody;
      const supplier = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.supplier.create({ data: supplierData(body) as Prisma.SupplierCreateInput });
        await writeAdminAuditLog(tx, request, { action: 'supplier_created', target_type: 'Supplier', target_id: created.id, payload: { name: created.name } });
        return created;
      });
      return ok(supplier);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '创建供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/update', async (request, reply) => {
    try {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const body = request.body as SupplierBody;
      const supplier = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.supplier.update({ where: { id }, data: supplierData(body, true) as Prisma.SupplierUpdateInput });
        await writeAdminAuditLog(tx, request, { action: 'supplier_updated', target_type: 'Supplier', target_id: updated.id, payload: { name: updated.name } });
        return updated;
      });
      return ok(supplier);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '更新供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/disable', async (request, reply) => {
    try {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const supplier = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.supplier.update({ where: { id }, data: { status: 'inactive' } });
        await writeAdminAuditLog(tx, request, { action: 'supplier_disabled', target_type: 'Supplier', target_id: updated.id, payload: { name: updated.name } });
        return updated;
      });
      return ok(supplier);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '禁用供应商失败');
    }
  });
}
