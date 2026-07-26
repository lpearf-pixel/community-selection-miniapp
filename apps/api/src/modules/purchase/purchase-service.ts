import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import type { AdminPurchaseReceiveCommand } from './admin-purchase-receive-command.js';
import { executeAdminPurchaseReceiveCommand } from './admin-purchase-receive-executor.js';
import { transitionPurchasePlan } from './purchase-plan-owner.js';

type AdminMeta = { admin_user_id: string; ip_address?: string | null; user_agent?: string | null };
type CreatePurchasePlanBody = {
  target_date?: string;
  supplier_name?: string;
  items?: Array<{ product_id?: string; planned_quantity?: number; cost_price_cents?: number; purchase_quantity?: number; purchase_unit?: string; stock_in_quantity?: number; remark?: string }>;
  remark?: string;
};

function makePlanNo() {
  return `PP${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

export async function createPurchasePlan(input: { body: CreatePurchasePlanBody; admin: AdminMeta }) {
  const targetDate = input.body.target_date ? new Date(input.body.target_date) : null;
  if (!targetDate || Number.isNaN(targetDate.getTime())) throw new Error('目标日期不合法');
  if (!input.body.items?.length) throw new Error('采购计划明细不能为空');
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const productIds = input.body.items?.map((item) => item.product_id).filter(Boolean) as string[];
    const products = await tx.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const items = (input.body.items ?? []).map((item) => {
      if (!item.product_id || !productMap.has(item.product_id)) throw new Error('采购商品不存在');
      const stockInQuantity = item.stock_in_quantity === undefined ? undefined : Number(item.stock_in_quantity);
      const plannedQuantity = stockInQuantity ?? Number(item.planned_quantity);
      const purchaseQuantity = item.purchase_quantity === undefined ? null : Number(item.purchase_quantity);
      const costPriceCents = Number(item.cost_price_cents ?? 0);
      if (!Number.isInteger(plannedQuantity) || plannedQuantity <= 0) throw new Error('计划入库库存数量必须大于 0');
      if (purchaseQuantity !== null && (!Number.isInteger(purchaseQuantity) || purchaseQuantity <= 0)) throw new Error('采购数量必须大于 0');
      if (!Number.isInteger(costPriceCents) || costPriceCents < 0) throw new Error('采购成本金额不合法');
      const product = productMap.get(item.product_id)!;
      const subtotalBaseQuantity = purchaseQuantity ?? plannedQuantity;
      return {
        product_id: product.id,
        product_name_snapshot: product.name,
        planned_quantity: plannedQuantity,
        purchase_quantity: purchaseQuantity,
        purchase_unit: item.purchase_unit?.trim() || null,
        stock_in_quantity: stockInQuantity ?? plannedQuantity,
        cost_price_cents: costPriceCents,
        subtotal_cents: subtotalBaseQuantity * costPriceCents,
        remark: item.remark ?? null
      };
    });
    const created = await tx.purchasePlan.create({
      data: {
        plan_no: makePlanNo(),
        target_date: targetDate,
        supplier_name: input.body.supplier_name ?? null,
        total_quantity: items.reduce((sum, item) => sum + item.planned_quantity, 0),
        total_amount_cents: items.reduce((sum, item) => sum + item.subtotal_cents, 0),
        created_by_admin_id: input.admin.admin_user_id,
        remark: input.body.remark ?? null,
        items: { create: items }
      },
      include: { items: true }
    });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_plan_created', target_type: 'PurchasePlan', target_id: created.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null, payload: { plan_no: created.plan_no } });
    return created;
  });
}

export async function confirmPurchasePlan(input: { id: string; admin: AdminMeta }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await transitionPurchasePlan(tx, {
      purchase_plan_id: input.id,
      action: 'confirm',
    });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_plan_confirmed', target_type: 'PurchasePlan', target_id: input.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null });
    return updated;
  });
}

export async function cancelPurchasePlan(input: { id: string; admin: AdminMeta }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await transitionPurchasePlan(tx, {
      purchase_plan_id: input.id,
      action: 'cancel',
    });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_plan_cancelled', target_type: 'PurchasePlan', target_id: input.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null });
    return updated;
  });
}

export async function receivePurchasePlan(input: {
  id: string;
  body: AdminPurchaseReceiveCommand;
  admin: AdminMeta;
}) {
  return executeAdminPurchaseReceiveCommand({
    purchase_plan_id: input.id,
    command: input.body,
    context: { admin_user_id: input.admin.admin_user_id },
    admin_meta: {
      ip_address: input.admin.ip_address,
      user_agent: input.admin.user_agent,
    },
  });
}
