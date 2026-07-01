import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';

type AdjustBody = { adjust_quantity?: number; reason?: string };
type CreatePurchasePlanBody = {
  target_date?: string;
  supplier_name?: string;
  items?: Array<{ product_id?: string; planned_quantity?: number; cost_price_cents?: number; remark?: string }>;
  remark?: string;
};
type ReceivePurchasePlanBody = { items?: Array<{ item_id?: string; received_quantity?: number }>; remark?: string };

const lowStockThreshold = 10;
const targetStock = 30;

function requireAdmin(request: { adminUser?: { id: string } }) {
  if (!request.adminUser?.id) throw new Error('后台登录已失效');
  return request.adminUser.id;
}

function makePlanNo() {
  return `PP${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
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
            payload: { adjust_quantity: adjustQuantity }
          }
        });
        await writeAdminAuditLog(tx, request, {
          action: 'inventory_manual_adjusted',
          target_type: 'Product',
          target_id: id,
          payload: { adjust_quantity: adjustQuantity, stock_before: current.stock, stock_after: nextStock, reason: body.reason }
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
          const plannedQuantity = Number(item.planned_quantity);
          const costPriceCents = Number(item.cost_price_cents ?? 0);
          if (!Number.isInteger(plannedQuantity) || plannedQuantity <= 0) throw new Error('计划采购数量必须大于 0');
          if (!Number.isInteger(costPriceCents) || costPriceCents < 0) throw new Error('采购成本金额不合法');
          const product = productMap.get(item.product_id)!;
          return {
            product_id: product.id,
            product_name_snapshot: product.name,
            planned_quantity: plannedQuantity,
            cost_price_cents: costPriceCents,
            subtotal_cents: plannedQuantity * costPriceCents,
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
              stock_after: product.stock + receivedQuantity,
              operator_type: 'admin',
              operator_id: adminUserId,
              remark: body.remark ?? null,
              payload: { purchase_plan_id: current.id, purchase_plan_item_id: item.id }
            }
          });
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
}
