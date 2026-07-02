import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import { receivePurchaseStock } from '../inventory/inventory-service.js';

type AdminMeta = { admin_user_id: string; ip_address?: string | null; user_agent?: string | null };
type CreatePurchasePlanBody = {
  target_date?: string;
  supplier_name?: string;
  items?: Array<{ product_id?: string; planned_quantity?: number; cost_price_cents?: number; purchase_quantity?: number; purchase_unit?: string; stock_in_quantity?: number; remark?: string }>;
  remark?: string;
};
type ReceivePurchasePlanBody = { items?: Array<{ item_id?: string; received_quantity?: number; supplier_id?: string; production_date?: string; arrival_date?: string; shelf_life_days?: number; remark?: string }>; remark?: string };

function makePlanNo() {
  return `PP${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function makeBatchNo() {
  return `PB${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
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
    const current = await tx.purchasePlan.findUnique({ where: { id: input.id } });
    if (!current) throw new Error('采购计划不存在');
    if (current.status !== 'draft') throw new Error('仅草稿采购计划可确认');
    const updated = await tx.purchasePlan.update({ where: { id: input.id }, data: { status: 'confirmed' }, include: { items: true } });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_plan_confirmed', target_type: 'PurchasePlan', target_id: input.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null });
    return updated;
  });
}

export async function cancelPurchasePlan(input: { id: string; admin: AdminMeta }) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.purchasePlan.findUnique({ where: { id: input.id } });
    if (!current) throw new Error('采购计划不存在');
    if (!['draft', 'confirmed'].includes(current.status)) throw new Error('当前采购计划不可取消');
    const updated = await tx.purchasePlan.update({ where: { id: input.id }, data: { status: 'cancelled' }, include: { items: true } });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_plan_cancelled', target_type: 'PurchasePlan', target_id: input.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null });
    return updated;
  });
}

export async function receivePurchasePlan(input: { id: string; body: ReceivePurchasePlanBody; admin: AdminMeta }) {
  if (!input.body.items?.length) throw new Error('入库明细不能为空');
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.purchasePlan.findUnique({ where: { id: input.id }, include: { items: true } });
    if (!current) throw new Error('采购计划不存在');
    if (!['confirmed', 'ordered'].includes(current.status)) throw new Error('仅已确认或已下单采购计划可入库');
    const itemMap = new Map(current.items.map((item) => [item.id, item]));
    for (const receivedItem of input.body.items ?? []) {
      if (!receivedItem.item_id || !itemMap.has(receivedItem.item_id)) throw new Error('入库明细不存在');
      const item = itemMap.get(receivedItem.item_id)!;
      const receivedQuantity = Number(receivedItem.received_quantity);
      if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0) throw new Error('入库数量必须大于等于 0');
      if (item.received_quantity + receivedQuantity > item.planned_quantity) throw new Error('累计入库数量不能超过计划数量');
      if (receivedQuantity <= 0) continue;
      const supplier = receivedItem.supplier_id ? await tx.supplier.findUnique({ where: { id: receivedItem.supplier_id } }) : null;
      if (receivedItem.supplier_id && !supplier) throw new Error('供应商不存在');
      const arrivalDate = receivedItem.arrival_date ? new Date(receivedItem.arrival_date) : new Date();
      if (Number.isNaN(arrivalDate.getTime())) throw new Error('到货日期不合法');
      const productionDate = receivedItem.production_date ? new Date(receivedItem.production_date) : null;
      if (productionDate && Number.isNaN(productionDate.getTime())) throw new Error('生产日期不合法');
      const shelfLifeDays = receivedItem.shelf_life_days === undefined ? null : Number(receivedItem.shelf_life_days);
      if (shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays <= 0)) throw new Error('保质期天数必须大于 0');
      const expireAt = shelfLifeDays ? new Date(arrivalDate.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000) : null;
      const receivedStock = await receivePurchaseStock(tx, { product_id: item.product_id, purchase_plan_id: current.id, purchase_plan_item_id: item.id, received_quantity: receivedQuantity, admin_user_id: input.admin.admin_user_id, remark: input.body.remark ?? null, payload: { purchase_unit: item.purchase_unit, purchase_quantity: item.purchase_quantity, stock_in_quantity: item.stock_in_quantity ?? item.planned_quantity } });
      await tx.purchasePlanItem.update({ where: { id: item.id }, data: { received_quantity: { increment: receivedQuantity } } });
      item.received_quantity += receivedQuantity;
      const batch = await tx.productBatch.create({
        data: {
          batch_no: makeBatchNo(),
          product_id: item.product_id,
          supplier_id: supplier?.id ?? null,
          purchase_plan_id: current.id,
          purchase_plan_item_id: item.id,
          product_name_snapshot: item.product_name_snapshot,
          supplier_name_snapshot: supplier?.name ?? null,
          stock_unit: receivedStock.stock_unit,
          initial_quantity: receivedQuantity,
          remaining_quantity: receivedQuantity,
          cost_price_cents: item.cost_price_cents,
          production_date: productionDate,
          arrival_date: arrivalDate,
          shelf_life_days: shelfLifeDays,
          expire_at: expireAt,
          status: 'active',
          remark: receivedItem.remark ?? input.body.remark ?? null,
          payload: { purchase_unit: item.purchase_unit, purchase_quantity: item.purchase_quantity, stock_in_quantity: item.stock_in_quantity ?? item.planned_quantity }
        }
      });
      await tx.batchStockLedger.create({ data: { batch_id: batch.id, product_id: item.product_id, source_type: 'purchase_batch_in', source_id: current.id, direction: 'in', quantity: receivedQuantity, batch_quantity_before: 0, batch_quantity_after: receivedQuantity, product_stock_before: receivedStock.stock_before, product_stock_after: receivedStock.stock_after, operator_type: 'admin', operator_id: input.admin.admin_user_id, remark: receivedItem.remark ?? input.body.remark ?? null, payload: { purchase_plan_item_id: item.id, supplier_id: supplier?.id ?? null, expire_at: expireAt?.toISOString() ?? null } } });
      await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_batch_created', target_type: 'ProductBatch', target_id: batch.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null, payload: { batch_no: batch.batch_no, purchase_plan_id: current.id } });
    }
    const allReceived = current.items.every((item) => item.received_quantity >= item.planned_quantity);
    const updated = await tx.purchasePlan.update({ where: { id: input.id }, data: { status: allReceived ? 'received' : 'ordered' }, include: { items: true } });
    await recordAdminAudit(tx, { admin_user_id: input.admin.admin_user_id, action: 'purchase_plan_received', target_type: 'PurchasePlan', target_id: input.id, ip_address: input.admin.ip_address ?? null, user_agent: input.admin.user_agent ?? null, payload: { remark: input.body.remark ?? null } });
    return updated;
  });
}
