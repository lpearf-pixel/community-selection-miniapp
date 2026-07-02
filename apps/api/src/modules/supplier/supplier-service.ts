import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit } from '../audit/audit-service.js';

type SupplierBody = {
  name?: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  license_no?: string | null;
  certification_info?: unknown;
  remark?: string | null;
};

type AdminMeta = { admin_user_id: string; ip_address?: string | null; user_agent?: string | null };

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

export async function listSuppliers(input: { status?: string }) {
  return prisma.supplier.findMany({
    where: { ...(input.status ? { status: input.status } : {}) },
    orderBy: { created_at: 'desc' }
  });
}

export async function createSupplier(input: { body: SupplierBody; admin: AdminMeta }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.supplier.create({ data: supplierData(input.body) as Prisma.SupplierCreateInput });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'supplier_created', target_type: 'Supplier', target_id: created.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null, payload: { name: created.name } });
    return created;
  });
}

export async function updateSupplier(input: { id: string; body: SupplierBody; admin: AdminMeta }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.supplier.update({ where: { id: input.id }, data: supplierData(input.body, true) as Prisma.SupplierUpdateInput });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'supplier_updated', target_type: 'Supplier', target_id: updated.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null, payload: { name: updated.name } });
    return updated;
  });
}

export async function disableSupplier(input: { id: string; admin: AdminMeta }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.supplier.update({ where: { id: input.id }, data: { status: 'inactive' } });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'supplier_disabled', target_type: 'Supplier', target_id: updated.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null, payload: { name: updated.name } });
    return updated;
  });
}
