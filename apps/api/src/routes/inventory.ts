import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { contractFail, contractOk, fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { confirmStockCheck, recordBatchLoss } from '../modules/inventory/inventory-service.js';
import { cancelPurchasePlan, confirmPurchasePlan, createPurchasePlan, receivePurchasePlan } from '../modules/purchase/purchase-service.js';
import { recordAdminAudit } from '../modules/audit/audit-service.js';
import {
  requireAdminPermissionV1,
  resolveAdminAccessContext,
} from '../modules/admin-access/admin-access-control.js';
import { parseAdminInventoryAdjustCommand } from '../modules/inventory/admin-inventory-adjust-command.js';
import {
  AdminInventoryAdjustCommandError,
  executeAdminInventoryAdjustCommand,
} from '../modules/inventory/admin-inventory-adjust-executor.js';
import { parseAdminPurchaseReceiveCommand } from '../modules/purchase/admin-purchase-receive-command.js';
import { AdminPurchaseReceiveCommandError } from '../modules/purchase/admin-purchase-receive-executor.js';

type CreatePurchasePlanBody = {
  target_date?: string;
  supplier_name?: string;
  items?: Array<{ product_id?: string; planned_quantity?: number; cost_price_cents?: number; purchase_quantity?: number; purchase_unit?: string; stock_in_quantity?: number; remark?: string }>;
  remark?: string;
};

const lowStockThreshold = 10;
const targetStock = 30;

function requireAdmin(request: { adminUser?: { id: string } }) {
  if (!request.adminUser?.id) throw new Error('后台登录已失效');
  return request.adminUser.id;
}


function makeStockCheckNo() {
  return `SC${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
}

function daysToExpire(expireAt: Date | null) {
  if (!expireAt) return null;
  return Math.ceil((expireAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

async function writeAdminAuditLog(tx: Prisma.TransactionClient, request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }, input: { action: string; target_type: string; target_id: string; payload?: unknown }) {
  await recordAdminAudit(tx, {
    admin_user_id: request.adminUser?.id ?? null,
    action: input.action,
    target_type: input.target_type,
    target_id: input.target_id,
    ip_address: request.ip ?? null,
    user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    payload: input.payload === undefined ? Prisma.JsonNull : input.payload as Prisma.InputJsonValue
  });
}

function adminMeta(request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }) {
  return {
    admin_user_id: requireAdmin(request),
    ip_address: request.ip ?? null,
    user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null
  };
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

  app.post(
    '/api/admin/inventory/products/:id/adjust',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('product.manage'),
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
      const parsed = parseAdminInventoryAdjustCommand(request.body);
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
        const result = await executeAdminInventoryAdjustCommand({
          product_id: id,
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
          code: 'ADMIN_INVENTORY_ADJUSTED',
          message: '库存调整成功',
          traceId,
        });
      } catch (error) {
        if (error instanceof AdminInventoryAdjustCommandError) {
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
            product_id: id,
            trace_id: traceId,
          },
          'Admin inventory adjustment failed',
        );
        reply.code(500);
        return contractFail({
          code: 'ADMIN_INVENTORY_ADJUST_FAILED',
          message: '库存调整失败',
          traceId,
        });
      }
    },
  );

  app.post('/api/admin/purchase-plans', async (request, reply) => {
    try {
      return ok(await createPurchasePlan({ body: request.body as CreatePurchasePlanBody, admin: adminMeta(request) }));
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
      const { id } = request.params as { id: string };
      return ok(await confirmPurchasePlan({ id, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '确认采购计划失败');
    }
  });

  app.post('/api/admin/purchase-plans/:id/cancel', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await cancelPurchasePlan({ id, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '取消采购计划失败');
    }
  });

  app.post('/api/admin/purchase-plans/:id/receive', async (request, reply) => {
    try {
      const admin = adminMeta(request);
      const parsed = parseAdminPurchaseReceiveCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return fail(parsed.message);
      }
      const { id } = request.params as { id: string };
      return ok(await receivePurchasePlan({ id, body: parsed.value, admin }));
    } catch (error) {
      if (error instanceof AdminPurchaseReceiveCommandError) {
        reply.code(error.statusCode);
        return fail(error.message);
      }
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
        const result = await recordBatchLoss(tx, { batch_id: id, quantity, loss_type: body.loss_type!, reason: body.reason!.trim(), responsible_type: body.responsible_type, supplier_id: body.supplier_id, admin_user_id: adminUserId });
        await recordAdminAudit(tx, {
          admin_user_id: adminUserId,
          action: 'inventory_loss_recorded',
          target_type: 'InventoryLoss',
          target_id: result.loss.id,
          ip_address: request.ip ?? null,
          user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
          payload: { batch_id: id, quantity }
        });
        return result.loss;
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
        const updated = await confirmStockCheck(tx, { stock_check_id: id, admin_user_id: adminUserId });
        await recordAdminAudit(tx, {
          admin_user_id: adminUserId,
          action: 'stock_check_confirmed',
          target_type: 'StockCheck',
          target_id: id,
          ip_address: request.ip ?? null,
          user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
          payload: { check_no: updated.check_no }
        });
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
