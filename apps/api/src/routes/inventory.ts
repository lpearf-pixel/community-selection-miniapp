import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

type AdjustBody = { adjust_quantity?: number; reason?: string };
type CreatePurchasePlanBody = {
  target_date?: string;
  supplier_name?: string;
  items?: Array<{ product_id?: string; planned_quantity?: number; cost_price_cents?: number; purchase_quantity?: number; purchase_unit?: string; stock_in_quantity?: number; remark?: string }>;
  remark?: string;
};
type ReceivePurchasePlanBody = { items?: Array<{ item_id?: string; received_quantity?: number; supplier_id?: string; production_date?: string; arrival_date?: string; shelf_life_days?: number; remark?: string }>; remark?: string };

const lowStockThreshold = 10;
const targetStock = 30;

function requireAdmin(request: { adminUser?: { id: string } }) {
  if (!request.adminUser?.id) throw new Error('后台登录已失效');
  return request.adminUser.id;
}

function makePlanNo() {
  return `PP${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function makeBatchNo() {
  return `PB${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function makeStockCheckNo() {
  return `SC${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function daysToExpire(expireAt: Date | null) {
  if (!expireAt) return null;
  return Math.ceil((expireAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
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

export function registerInventoryRoutes(app: FastifyInstance) {
  app.get('/api/admin/inventory/overview', async (request, reply) => {
    try {
      requireAdmin(request);
      const products = await prisma.product.findMany({
        where: { status: { in: ['active', 'inactive'] } },
        orderBy: { updated_at: 'desc' }
      });
      const items = products.map((product) => ({
        product_id: product.id,
        product_name: product.name,
        stock: product.stock,
        unit: product.unit,
        stock_unit: product.stock_unit,
        sale_unit: product.sale_unit,
        sale_spec_name: product.sale_spec_name,
        stock_deduct_quantity: product.stock_deduct_quantity,
        display_stock: `${product.stock} ${product.stock_unit}`,
        display_sale_spec: product.sale_spec_name ? `${product.sale_spec_name} / ${product.sale_unit}` : product.sale_unit,
        status: product.status,
        low_stock_threshold: lowStockThreshold,
        suggest_purchase_quantity: Math.max(0, targetStock - product.stock)
      }));
      return ok({
        low_stock_count: items.filter((item) => item.stock > 0 && item.stock <= item.low_stock_threshold).length,
        out_of_stock_count: items.filter((item) => item.stock <= 0).length,
        total_sku_count: items.length,
        items
      });
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询库存概览失败');
    }
  });

  app.get('/api/admin/inventory/ledger', async (request, reply) => {
    try {
      requireAdmin(request);
      const query = request.query as { product_id?: string };
      if (!query.product_id) throw new Error('缺少商品 ID');
      const ledgers = await prisma.stockLedger.findMany({
        where: { product_id: query.product_id },
        orderBy: { created_at: 'desc' },
        take: 200
      });
      return ok(ledgers);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询库存流水失败');
    }
  });

  app.post('/api/admin/inventory/products/:id/adjust', async (request, reply) => {
    try {
      const adminUserId = requireAdmin(request);
      const { id } = request.params as { id: string };
      const body = request.body as AdjustBody;
      const adjustQuantity = Number(body.adjust_quantity);
      if (!Number.isInteger(adjustQuantity) || adjustQuantity === 0) throw new Error('调整数量必须为非零整数');
      if (!body.reason?.trim()) throw new Error('缺少库存调整原因');
      const product = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.product.findUnique({ where: { id } });
        if (!current) throw new Error('商品不存在');
        const nextStock = current.stock + adjustQuantity;
        if (nextStock < 0) throw new Error('库存不能调整为负数');
        const updated = await tx.product.update({ where: { id }, data: { stock: nextStock } });
        await tx.stockLedger.create({
          data: {
            product_id: id,
            source_type: 'manual_adjust',
            source_id: id,
            direction: adjustQuantity > 0 ? 'in' : 'out',
            quantity: Math.abs(adjustQuantity),
            stock_before: current.stock,
            stock_after: nextStock,
            operator_type: 'admin',
            operator_id: adminUserId,
            remark: body.reason,
            payload: { adjust_quantity: adjustQuantity, stock_unit: current.stock_unit, sale_unit: current.sale_unit, sale_spec_name: current.sale_spec_name, stock_deduct_quantity: current.stock_deduct_quantity }
          }
        });
        await writeAdminAuditLog(tx, request, {
          action: 'inventory_manual_adjusted',
          target_type: 'Product',
          target_id: id,
          payload: { adjust_quantity: adjustQuantity, stock_before: current.stock, stock_after: nextStock, reason: body.reason, stock_unit: current.stock_unit, sale_unit: current.sale_unit, sale_spec_name: current.sale_spec_name, stock_deduct_quantity: current.stock_deduct_quantity }
        });
        return updated;
      });
      return ok(product);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '库存调整失败');
    }
  });

  app.post('/api/admin/purchase-plans', async (request, reply) => {
    try {
      const adminUserId = requireAdmin(request);
      const body = request.body as CreatePurchasePlanBody;
      const targetDate = body.target_date ? new Date(body.target_date) : null;
      if (!targetDate || Number.isNaN(targetDate.getTime())) throw new Error('目标日期不合法');
      if (!body.items?.length) throw new Error('采购计划明细不能为空');
      const plan = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const productIds = body.items?.map((item) => item.product_id).filter(Boolean) as string[];
        const products = await tx.product.findMany({ where: { id: { in: productIds } } });
        const productMap = new Map(products.map((product) => [product.id, product]));
        const items = (body.items ?? []).map((item) => {
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
            supplier_name: body.supplier_name ?? null,
            total_quantity: items.reduce((sum, item) => sum + item.planned_quantity, 0),
            total_amount_cents: items.reduce((sum, item) => sum + item.subtotal_cents, 0),
            created_by_admin_id: adminUserId,
            remark: body.remark ?? null,
            items: { create: items }
          },
          include: { items: true }
        });
        await writeAdminAuditLog(tx, request, { action: 'purchase_plan_created', target_type: 'PurchasePlan', target_id: created.id, payload: { plan_no: created.plan_no } });
        return created;
      });
      return ok(plan);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '创建采购计划失败');
    }
  });

  app.get('/api/admin/purchase-plans', async (request, reply) => {
    try {
      requireAdmin(request);
      const query = request.query as { status?: string; target_date?: string };
      const range = query.target_date ? (() => {
        const start = new Date(`${query.target_date}T00:00:00.000Z`);
        if (Number.isNaN(start.getTime())) throw new Error('目标日期不合法');
        return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
      })() : null;
      const plans = await prisma.purchasePlan.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(range ? { target_date: { gte: range.start, lt: range.end } } : {})
        },
        include: { items: true },
        orderBy: { created_at: 'desc' }
      });
      return ok(plans);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询采购计划失败');
    }
  });

  app.post('/api/admin/purchase-plans/:id/confirm', async (request, reply) => {
    try {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const plan = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.purchasePlan.findUnique({ where: { id } });
        if (!current) throw new Error('采购计划不存在');
        if (current.status !== 'draft') throw new Error('仅草稿采购计划可确认');
        const updated = await tx.purchasePlan.update({ where: { id }, data: { status: 'confirmed' }, include: { items: true } });
        await writeAdminAuditLog(tx, request, { action: 'purchase_plan_confirmed', target_type: 'PurchasePlan', target_id: id });
        return updated;
      });
      return ok(plan);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '确认采购计划失败');
    }
  });

  app.post('/api/admin/purchase-plans/:id/cancel', async (request, reply) => {
    try {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const plan = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.purchasePlan.findUnique({ where: { id } });
        if (!current) throw new Error('采购计划不存在');
        if (!['draft', 'confirmed'].includes(current.status)) throw new Error('当前采购计划不可取消');
        const updated = await tx.purchasePlan.update({ where: { id }, data: { status: 'cancelled' }, include: { items: true } });
        await writeAdminAuditLog(tx, request, { action: 'purchase_plan_cancelled', target_type: 'PurchasePlan', target_id: id });
        return updated;
      });
      return ok(plan);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '取消采购计划失败');
    }
  });

  app.post('/api/admin/purchase-plans/:id/receive', async (request, reply) => {
    try {
      const adminUserId = requireAdmin(request);
      const { id } = request.params as { id: string };
      const body = request.body as ReceivePurchasePlanBody;
      if (!body.items?.length) throw new Error('入库明细不能为空');
      const plan = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.purchasePlan.findUnique({ where: { id }, include: { items: true } });
        if (!current) throw new Error('采购计划不存在');
        if (!['confirmed', 'ordered'].includes(current.status)) throw new Error('仅已确认或已下单采购计划可入库');
        const itemMap = new Map(current.items.map((item) => [item.id, item]));
        for (const input of body.items ?? []) {
          if (!input.item_id || !itemMap.has(input.item_id)) throw new Error('入库明细不存在');
          const item = itemMap.get(input.item_id)!;
          const receivedQuantity = Number(input.received_quantity);
          if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0) throw new Error('入库数量必须大于等于 0');
          if (item.received_quantity + receivedQuantity > item.planned_quantity) throw new Error('累计入库数量不能超过计划数量');
          if (receivedQuantity <= 0) continue;
          const product = await tx.product.findUnique({ where: { id: item.product_id } });
          if (!product) throw new Error('入库商品不存在');
          const supplier = input.supplier_id ? await tx.supplier.findUnique({ where: { id: input.supplier_id } }) : null;
          if (input.supplier_id && !supplier) throw new Error('供应商不存在');
          const arrivalDate = input.arrival_date ? new Date(input.arrival_date) : new Date();
          if (Number.isNaN(arrivalDate.getTime())) throw new Error('到货日期不合法');
          const productionDate = input.production_date ? new Date(input.production_date) : null;
          if (productionDate && Number.isNaN(productionDate.getTime())) throw new Error('生产日期不合法');
          const shelfLifeDays = input.shelf_life_days === undefined ? null : Number(input.shelf_life_days);
          if (shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays <= 0)) throw new Error('保质期天数必须大于 0');
          const expireAt = shelfLifeDays ? new Date(arrivalDate.getTime() + shelfLifeDays * 24 * 60 * 60 * 1000) : null;
          const productStockAfter = product.stock + receivedQuantity;
          await tx.product.update({ where: { id: item.product_id }, data: { stock: { increment: receivedQuantity } } });
          await tx.purchasePlanItem.update({ where: { id: item.id }, data: { received_quantity: { increment: receivedQuantity } } });
          item.received_quantity += receivedQuantity;
          await tx.stockLedger.create({
            data: {
              product_id: item.product_id,
              source_type: 'purchase_in',
              source_id: current.id,
              direction: 'in',
              quantity: receivedQuantity,
              stock_before: product.stock,
              stock_after: productStockAfter,
              operator_type: 'admin',
              operator_id: adminUserId,
              remark: body.remark ?? null,
              payload: { purchase_plan_id: current.id, purchase_plan_item_id: item.id, stock_unit: product.stock_unit, purchase_unit: item.purchase_unit, purchase_quantity: item.purchase_quantity, stock_in_quantity: item.stock_in_quantity ?? item.planned_quantity }
            }
          });
          const batch = await tx.productBatch.create({
            data: {
              batch_no: makeBatchNo(),
              product_id: item.product_id,
              supplier_id: supplier?.id ?? null,
              purchase_plan_id: current.id,
              purchase_plan_item_id: item.id,
              product_name_snapshot: item.product_name_snapshot,
              supplier_name_snapshot: supplier?.name ?? null,
              stock_unit: product.stock_unit,
              initial_quantity: receivedQuantity,
              remaining_quantity: receivedQuantity,
              cost_price_cents: item.cost_price_cents,
              production_date: productionDate,
              arrival_date: arrivalDate,
              shelf_life_days: shelfLifeDays,
              expire_at: expireAt,
              status: 'active',
              remark: input.remark ?? body.remark ?? null,
              payload: { purchase_unit: item.purchase_unit, purchase_quantity: item.purchase_quantity, stock_in_quantity: item.stock_in_quantity ?? item.planned_quantity }
            }
          });
          await tx.batchStockLedger.create({
            data: {
              batch_id: batch.id,
              product_id: item.product_id,
              source_type: 'purchase_batch_in',
              source_id: current.id,
              direction: 'in',
              quantity: receivedQuantity,
              batch_quantity_before: 0,
              batch_quantity_after: receivedQuantity,
              product_stock_before: product.stock,
              product_stock_after: productStockAfter,
              operator_type: 'admin',
              operator_id: adminUserId,
              remark: input.remark ?? body.remark ?? null,
              payload: { purchase_plan_item_id: item.id, supplier_id: supplier?.id ?? null, expire_at: expireAt?.toISOString() ?? null }
            }
          });
          await writeAdminAuditLog(tx, request, { action: 'purchase_batch_created', target_type: 'ProductBatch', target_id: batch.id, payload: { batch_no: batch.batch_no, purchase_plan_id: current.id } });
        }
        const allReceived = current.items.every((item) => item.received_quantity >= item.planned_quantity);
        const updated = await tx.purchasePlan.update({ where: { id }, data: { status: allReceived ? 'received' : 'ordered' }, include: { items: true } });
        await writeAdminAuditLog(tx, request, { action: 'purchase_plan_received', target_type: 'PurchasePlan', target_id: id, payload: { remark: body.remark ?? null } });
        return updated;
      });
      return ok(plan);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '采购入库失败');
    }
  });

  app.get('/api/admin/inventory/batches', async (request, reply) => {
    try {
      requireAdmin(request);
      const query = request.query as { product_id?: string; supplier_id?: string; status?: string; expiring_days?: string };
      const expiringDays = query.expiring_days === undefined ? null : Number(query.expiring_days);
      if (expiringDays !== null && (!Number.isInteger(expiringDays) || expiringDays < 0)) throw new Error('临期天数不合法');
      const now = new Date();
      const batches = await prisma.productBatch.findMany({
        where: {
          ...(query.product_id ? { product_id: query.product_id } : {}),
          ...(query.supplier_id ? { supplier_id: query.supplier_id } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(expiringDays !== null ? { remaining_quantity: { gt: 0 }, expire_at: { not: null, lte: new Date(now.getTime() + expiringDays * 24 * 60 * 60 * 1000) } } : {})
        },
        orderBy: [{ expire_at: 'asc' }, { created_at: 'desc' }]
      });
      return ok(batches.map((batch) => {
        const dayCount = daysToExpire(batch.expire_at);
        return {
          ...batch,
          days_to_expire: dayCount,
          status_hint: batch.expire_at && batch.expire_at.getTime() < Date.now() && batch.remaining_quantity > 0 ? 'expired' : batch.expire_at && expiringDays !== null ? 'expiring' : undefined
        };
      }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询批次失败');
    }
  });

  app.get('/api/admin/inventory/batches/:id/ledger', async (request, reply) => {
    try {
      requireAdmin(request);
      const { id } = request.params as { id: string };
      const ledgers = await prisma.batchStockLedger.findMany({ where: { batch_id: id }, orderBy: { created_at: 'desc' }, take: 200 });
      return ok(ledgers);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询批次流水失败');
    }
  });

  app.get('/api/admin/inventory/expiry-alerts', async (request, reply) => {
    try {
      requireAdmin(request);
      const query = request.query as { days?: string };
      const days = query.days === undefined ? 7 : Number(query.days);
      if (!Number.isInteger(days) || days < 0) throw new Error('临期天数不合法');
      const now = new Date();
      const batches = await prisma.productBatch.findMany({
        where: { remaining_quantity: { gt: 0 }, expire_at: { not: null, lte: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) } },
        orderBy: { expire_at: 'asc' }
      });
      return ok({
        days,
        items: batches.map((batch) => ({
          batch_id: batch.id,
          batch_no: batch.batch_no,
          product_id: batch.product_id,
          product_name: batch.product_name_snapshot,
          supplier_name: batch.supplier_name_snapshot,
          remaining_quantity: batch.remaining_quantity,
          stock_unit: batch.stock_unit,
          expire_at: batch.expire_at?.toISOString() ?? null,
          days_to_expire: daysToExpire(batch.expire_at),
          status_hint: batch.expire_at && batch.expire_at.getTime() < Date.now() ? 'expired' : 'expiring'
        }))
      });
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询临期提醒失败');
    }
  });

  app.post('/api/admin/inventory/batches/:id/loss', async (request, reply) => {
    try {
      const adminUserId = requireAdmin(request);
      const { id } = request.params as { id: string };
      const body = request.body as { quantity?: number; loss_type?: string; reason?: string; responsible_type?: string; supplier_id?: string };
      const quantity = Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('损耗数量必须大于 0');
      if (!body.loss_type) throw new Error('缺少损耗类型');
      if (!body.reason?.trim()) throw new Error('缺少损耗原因');
      const loss = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const batch = await tx.productBatch.findUnique({ where: { id } });
        if (!batch) throw new Error('批次不存在');
        if (batch.remaining_quantity < quantity) throw new Error('批次库存不足');
        const product = await tx.product.findUnique({ where: { id: batch.product_id } });
        if (!product) throw new Error('商品不存在');
        if (product.stock < quantity) throw new Error('商品库存不足');
        const batchAfter = batch.remaining_quantity - quantity;
        const productAfter = product.stock - quantity;
        const createdLoss = await tx.inventoryLoss.create({
          data: {
            product_id: batch.product_id,
            batch_id: batch.id,
            loss_type: body.loss_type,
            quantity,
            stock_unit: batch.stock_unit,
            reason: body.reason,
            responsible_type: body.responsible_type ?? 'unknown',
            supplier_id: body.supplier_id ?? batch.supplier_id,
            operator_admin_id: adminUserId,
            payload: { batch_no: batch.batch_no }
          }
        });
        await tx.productBatch.update({ where: { id: batch.id }, data: { remaining_quantity: batchAfter, status: batchAfter === 0 ? 'depleted' : batch.status } });
        await tx.product.update({ where: { id: batch.product_id }, data: { stock: productAfter } });
        await tx.batchStockLedger.create({ data: { batch_id: batch.id, product_id: batch.product_id, source_type: 'loss_out', source_id: createdLoss.id, direction: 'out', quantity, batch_quantity_before: batch.remaining_quantity, batch_quantity_after: batchAfter, product_stock_before: product.stock, product_stock_after: productAfter, operator_type: 'admin', operator_id: adminUserId, remark: body.reason, payload: { loss_type: body.loss_type, responsible_type: body.responsible_type ?? 'unknown' } } });
        await tx.stockLedger.create({ data: { product_id: batch.product_id, source_type: 'loss_out', source_id: createdLoss.id, direction: 'out', quantity, stock_before: product.stock, stock_after: productAfter, operator_type: 'admin', operator_id: adminUserId, remark: body.reason, payload: { batch_id: batch.id, batch_no: batch.batch_no, loss_type: body.loss_type, stock_unit: batch.stock_unit } } });
        await writeAdminAuditLog(tx, request, { action: 'inventory_loss_recorded', target_type: 'InventoryLoss', target_id: createdLoss.id, payload: { batch_id: batch.id, quantity } });
        return createdLoss;
      });
      return ok(loss);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '记录损耗失败');
    }
  });

  app.post('/api/admin/stock-checks', async (request, reply) => {
    try {
      const adminUserId = requireAdmin(request);
      const body = request.body as { items?: Array<{ product_id?: string; batch_id?: string; actual_quantity?: number; reason?: string }>; remark?: string };
      if (!body.items?.length) throw new Error('盘点明细不能为空');
      const stockCheck = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const items = [] as Array<{ product_id: string; batch_id: string | null; book_quantity: number; actual_quantity: number; diff_quantity: number; stock_unit: string; reason: string | null }>;
        for (const input of body.items ?? []) {
          const actualQuantity = Number(input.actual_quantity);
          if (!Number.isInteger(actualQuantity) || actualQuantity < 0) throw new Error('实际库存必须大于等于 0');
          if (input.batch_id) {
            const batch = await tx.productBatch.findUnique({ where: { id: input.batch_id } });
            if (!batch) throw new Error('盘点批次不存在');
            items.push({ product_id: batch.product_id, batch_id: batch.id, book_quantity: batch.remaining_quantity, actual_quantity: actualQuantity, diff_quantity: actualQuantity - batch.remaining_quantity, stock_unit: batch.stock_unit, reason: input.reason ?? null });
          } else {
            if (!input.product_id) throw new Error('缺少盘点商品');
            const product = await tx.product.findUnique({ where: { id: input.product_id } });
            if (!product) throw new Error('盘点商品不存在');
            items.push({ product_id: product.id, batch_id: null, book_quantity: product.stock, actual_quantity: actualQuantity, diff_quantity: actualQuantity - product.stock, stock_unit: product.stock_unit, reason: input.reason ?? null });
          }
        }
        const created = await tx.stockCheck.create({ data: { check_no: makeStockCheckNo(), operator_admin_id: adminUserId, remark: body.remark ?? null, items: { create: items } }, include: { items: true } });
        await writeAdminAuditLog(tx, request, { action: 'stock_check_created', target_type: 'StockCheck', target_id: created.id, payload: { check_no: created.check_no } });
        return created;
      });
      return ok(stockCheck);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '创建盘点失败');
    }
  });

  app.post('/api/admin/stock-checks/:id/confirm', async (request, reply) => {
    try {
      const adminUserId = requireAdmin(request);
      const { id } = request.params as { id: string };
      const stockCheck = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const current = await tx.stockCheck.findUnique({ where: { id }, include: { items: true } });
        if (!current) throw new Error('盘点单不存在');
        if (current.status !== 'draft') throw new Error('仅草稿盘点可确认');
        for (const item of current.items) {
          if (item.diff_quantity === 0) continue;
          const direction = item.diff_quantity >= 0 ? 'in' : 'out';
          const quantity = Math.abs(item.diff_quantity);
          const product = await tx.product.findUnique({ where: { id: item.product_id } });
          if (!product) throw new Error('盘点商品不存在');
          const productAfter = product.stock + item.diff_quantity;
          if (productAfter < 0) throw new Error('盘点后商品库存不能为负数');
          if (item.batch_id) {
            const batch = await tx.productBatch.findUnique({ where: { id: item.batch_id } });
            if (!batch) throw new Error('盘点批次不存在');
            if (item.actual_quantity < 0) throw new Error('盘点后批次库存不能为负数');
            await tx.productBatch.update({ where: { id: batch.id }, data: { remaining_quantity: item.actual_quantity, status: item.actual_quantity === 0 ? 'depleted' : batch.status } });
            await tx.batchStockLedger.create({ data: { batch_id: batch.id, product_id: item.product_id, source_type: 'stock_check_adjust', source_id: current.id, direction, quantity, batch_quantity_before: batch.remaining_quantity, batch_quantity_after: item.actual_quantity, product_stock_before: product.stock, product_stock_after: productAfter, operator_type: 'admin', operator_id: adminUserId, remark: item.reason, payload: { stock_check_item_id: item.id } } });
          }
          await tx.product.update({ where: { id: item.product_id }, data: { stock: productAfter } });
          await tx.stockLedger.create({ data: { product_id: item.product_id, source_type: 'stock_check_adjust', source_id: current.id, direction, quantity, stock_before: product.stock, stock_after: productAfter, operator_type: 'admin', operator_id: adminUserId, remark: item.reason, payload: { stock_check_item_id: item.id, batch_id: item.batch_id, stock_unit: item.stock_unit } } });
        }
        const updated = await tx.stockCheck.update({ where: { id }, data: { status: 'confirmed', confirmed_at: new Date() }, include: { items: true } });
        await writeAdminAuditLog(tx, request, { action: 'stock_check_confirmed', target_type: 'StockCheck', target_id: id, payload: { check_no: updated.check_no } });
        return updated;
      });
      return ok(stockCheck);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '确认盘点失败');
    }
  });

  app.get('/api/admin/stock-checks', async (request, reply) => {
    try {
      requireAdmin(request);
      const checks = await prisma.stockCheck.findMany({ include: { items: true }, orderBy: { created_at: 'desc' } });
      return ok(checks);
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询盘点单失败');
    }
  });

}
