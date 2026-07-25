import type { Prisma } from '@prisma/client';
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import {
  buildPaginationMetadata,
  contractFail,
  contractOk,
  fail,
  ok,
} from '@community-selection/shared';
import { prisma } from '../../db.js';
import { getOrderInventorySummary } from '../../modules/inventory/inventory-order-service.js';
import {
  ADMIN_SCOPE_FORBIDDEN,
  canAccessOrderDataScope,
  getScopedOrderWhere,
  requireAdminPermission,
  requireAdminPermissionV1,
  resolveAdminAccessContext,
} from '../../modules/admin-access/admin-access-control.js';
import {
  buildAdminOrderListWhere,
  parseAdminOrderListQuery,
  toAdminOrderListItem,
} from './order-list-query.js';
import { parseAdminOrderStatusCommand } from '../../modules/order/admin-order-status-command.js';
import {
  AdminOrderCommandError,
  executeAdminOrderStatusCommand,
} from '../../modules/order/admin-order-status-executor.js';
import {
  parseAdminPickupVerificationCommand,
} from '../../modules/order/admin-pickup-verification-command.js';
import {
  AdminPickupVerificationError,
  executeAdminPickupVerificationCommand,
} from '../../modules/order/admin-pickup-verification-executor.js';

function maskPhone(phone?: string | null) {
  return phone ? phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : null;
}

function maskAddress(address?: string | null) {
  return address ? `${address.slice(0, 6)}***` : null;
}

function publicProduct(product: any) {
  return product
    ? {
        product_id: product.id,
        name: product.name,
        cover_image: product.cover_image,
        price_cents: product.price_cents,
        sale_unit: product.sale_unit,
        sale_spec_name: product.sale_spec_name,
      }
    : null;
}

function publicAfterSale(item: any) {
  return {
    id: item.id,
    after_sale_case_id: item.id,
    order_id: item.order_id,
    type: item.type,
    status: item.status,
    reason: item.reason,
    requested_refund_cents: item.requested_refund_cents ?? 0,
    requested_product_refund_cents:
      item.requested_product_refund_cents ?? 0,
    requested_delivery_refund_cents:
      item.requested_delivery_refund_cents ?? 0,
    approved_refund_cents: item.approved_refund_cents ?? 0,
    approved_product_refund_cents: item.approved_product_refund_cents ?? 0,
    approved_delivery_refund_cents:
      item.approved_delivery_refund_cents ?? 0,
    responsibility: item.responsibility,
    admin_note: item.admin_note,
    reviewed_at: item.reviewed_at,
    resolved_at: item.resolved_at,
    reviewer: item.reviewed_by_admin
      ? {
          id: item.reviewed_by_admin.id,
          username: item.reviewed_by_admin.username,
        }
      : null,
    logs: (item.logs ?? []).map((log: any) => ({
      id: log.id,
      action: log.action,
      actor_type: log.actor_type,
      actor_id: log.actor_id,
      note: log.note,
      created_at: log.created_at,
    })),
  };
}

function adminOrderStatusV1ErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const invalidCommand = error.statusCode === 400;
  request.log.error(
    {
      error_name: error.name,
      trace_id: String(request.id),
    },
    'Admin order status request failed before handler',
  );
  reply.code(invalidCommand ? 400 : 500).send(
    contractFail({
      code: invalidCommand
        ? 'INVALID_ADMIN_ORDER_STATUS_COMMAND'
        : 'ADMIN_ORDER_STATUS_UPDATE_FAILED',
      message: invalidCommand
        ? '订单状态命令不合法'
        : '订单状态更新失败',
      traceId: String(request.id),
    }),
  );
}

function adminPickupVerificationV1ErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const invalidCommand = error.statusCode === 400;
  request.log.error(
    {
      error_name: error.name,
      trace_id: String(request.id),
    },
    'Admin pickup verification request failed before handler',
  );
  reply.code(invalidCommand ? 400 : 500).send(
    contractFail({
      code: invalidCommand
        ? 'INVALID_ADMIN_PICKUP_VERIFY_COMMAND'
        : 'ADMIN_PICKUP_VERIFY_FAILED',
      message: invalidCommand
        ? '自提核销命令不合法'
        : '自提核销失败',
      traceId: String(request.id),
    }),
  );
}

export function registerAdminOrderRoutes(app: FastifyInstance) {
  app.post(
    '/api/admin/orders/:id/pickup-verify',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('pickup.verify'),
      errorHandler: adminPickupVerificationV1ErrorHandler,
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

      const { id } = request.params as { id: string };
      const parsed = parseAdminPickupVerificationCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }

      try {
        const result = await executeAdminPickupVerificationCommand({
          order_id: id,
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
          code: 'ADMIN_PICKUP_VERIFIED',
          message: '自提核销成功',
          traceId,
        });
      } catch (error) {
        if (error instanceof AdminPickupVerificationError) {
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
            order_id: id,
            trace_id: traceId,
          },
          'Admin pickup verification failed',
        );
        reply.code(500);
        return contractFail({
          code: 'ADMIN_PICKUP_VERIFY_FAILED',
          message: '自提核销失败',
          traceId,
        });
      }
    },
  );

  app.post(
    '/api/admin/orders/:id/status',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('order.manage'),
      errorHandler: adminOrderStatusV1ErrorHandler,
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
      const { id } = request.params as { id: string };
      const rawCommand = request.body as {
        next_status?: unknown;
        expected_version?: unknown;
        idempotency_key?: unknown;
      };
      const parsed = parseAdminOrderStatusCommand(rawCommand);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }

      try {
        const result = await executeAdminOrderStatusCommand({
          order_id: id,
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
          code: 'ADMIN_ORDER_STATUS_UPDATED',
          message: '',
          traceId,
        });
      } catch (error) {
        if (error instanceof AdminOrderCommandError) {
          reply.code(error.statusCode);
          const code =
            error.code === 'ADMIN_ORDER_VERSION_CONFLICT'
              ? 'ADMIN_ORDER_VERSION_CONFLICT'
              : error.code;
          return contractFail({
            code,
            message: error.message,
            traceId,
          });
        }
        request.log.error(
          {
            error_name: error instanceof Error ? error.name : 'UnknownError',
            order_id: id,
            trace_id: traceId,
          },
          'Admin order status update failed',
        );
        reply.code(500);
        return contractFail({
          code: 'ADMIN_ORDER_STATUS_UPDATE_FAILED',
          message: '订单状态更新失败',
          traceId,
        });
      }
    },
  );

  app.get(
    '/api/admin/orders',
    { preHandler: requireAdminPermission('order.view') },
    async (request, reply) => {
      const traceId = String(request.id);
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return contractFail({
          code: 'ADMIN_UNAUTHORIZED',
          message: 'ADMIN_UNAUTHORIZED: Admin identity required',
          traceId,
        });
      }

      const parsed = parseAdminOrderListQuery(
        request.query as Record<string, unknown>,
      );
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }

      const scopeWhere = getScopedOrderWhere(context);
      if (!scopeWhere) {
        return contractOk(
          {
            items: [],
            pagination: buildPaginationMetadata({
              page: parsed.value.page,
              pageSize: parsed.value.page_size,
              total: 0,
            }),
          },
          {
            code: 'ADMIN_ORDERS_LISTED',
            message: '',
            traceId,
          },
        );
      }

      try {
        const where = buildAdminOrderListWhere(
          parsed.value,
          scopeWhere,
        ) as Prisma.OrderWhereInput;
        const [total, items] = await prisma.$transaction([
          prisma.order.count({ where }),
          prisma.order.findMany({
            where,
            include: {
              user: { select: { id: true, nickname: true } },
              product: true,
              group_buy: { include: { product: true, community: true } },
              pickup_store: true,
              community: true,
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
            skip: (parsed.value.page - 1) * parsed.value.page_size,
            take: parsed.value.page_size,
          }),
        ]);

        return contractOk(
          {
            items: items.map(toAdminOrderListItem),
            pagination: buildPaginationMetadata({
              page: parsed.value.page,
              pageSize: parsed.value.page_size,
              total,
            }),
          },
          {
            code: 'ADMIN_ORDERS_LISTED',
            message: '',
            traceId,
          },
        );
      } catch (error) {
        request.log.error(
          { err: error, trace_id: traceId },
          'Admin order list failed',
        );
        reply.code(500);
        return contractFail({
          code: 'ADMIN_ORDERS_LIST_FAILED',
          message: '订单列表加载失败',
          traceId,
        });
      }
    },
  );

  app.get(
    '/api/admin/orders/:id',
    { preHandler: requireAdminPermission('order.view') },
    async (request, reply) => {
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return fail('ADMIN_UNAUTHORIZED: Admin identity required');
      }
      const { id } = request.params as { id: string };
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          product: true,
          group_buy: { include: { product: true, community: true } },
          pickup_store: true,
          community: true,
          refunds: { orderBy: { created_at: 'asc' } },
          after_sale_cases: {
            include: {
              logs: { orderBy: { created_at: 'asc' } },
              reviewed_by_admin: true,
            },
            orderBy: { created_at: 'desc' },
          },
          payments: { orderBy: { created_at: 'asc' } },
        },
      });
      if (!order) {
        reply.code(404);
        return fail('订单不存在');
      }
      if (!canAccessOrderDataScope(context, order)) {
        reply.code(403);
        return fail(ADMIN_SCOPE_FORBIDDEN);
      }
      const timeline = await prisma.orderTimelineLog.findMany({
        where: { order_id: id },
        orderBy: { created_at: 'asc' },
      });
      const inventory_summary = await prisma.$transaction((tx) =>
        getOrderInventorySummary(tx, id),
      );
      const product = order.product ?? order.group_buy?.product ?? null;
      const productAmount =
        order.product_amount_cents ?? order.total_amount_cents;
      const remaining = Math.max(
        0,
        order.pay_amount_cents - order.refund_amount_cents,
      );
      return ok({
        id: order.id,
        order_id: order.id,
        order_no: order.order_no,
        order_type: order.group_buy_id ? 'group_buy' : 'normal',
        group_buy_id: order.group_buy_id,
        product_id: order.product_id ?? product?.id ?? null,
        user_id: order.user_id,
        product: publicProduct(product),
        quantity: order.quantity,
        total_amount_cents: order.total_amount_cents,
        product_amount_cents: productAmount,
        delivery_fee_cents: order.delivery_fee_cents ?? 0,
        pay_amount_cents: order.pay_amount_cents,
        product_refund_amount_cents: order.product_refund_amount_cents,
        delivery_refund_amount_cents: order.delivery_refund_amount_cents,
        refund_amount_cents: order.refund_amount_cents,
        remaining_refundable_amount_cents: remaining,
        pay_status: order.pay_status,
        order_status: order.order_status,
        version: order.version,
        refund_status: order.refund_status,
        pickup_type: order.pickup_type,
        delivery_method: order.pickup_type,
        delivery_time_window_code: order.delivery_time_window_code,
        delivery_time_window_text: order.delivery_time_window_text,
        pickup_store: order.pickup_store
          ? {
              pickup_store_id: order.pickup_store.id,
              name: order.pickup_store.name,
              address: order.pickup_store.address,
            }
          : null,
        community: order.community
          ? {
              community_id: order.community.id,
              name: order.community.name,
            }
          : order.group_buy?.community
            ? {
                community_id: order.group_buy.community.id,
                name: order.group_buy.community.name,
              }
            : null,
        receiver_name: order.receiver_name,
        receiver_phone_masked: maskPhone(order.receiver_phone),
        receiver_address_masked: maskAddress(order.receiver_address),
        after_sale_summary: {
          has_after_sale: order.after_sale_cases.length > 0,
          case_count: order.after_sale_cases.length,
          latest_status: order.after_sale_cases[0]?.status ?? null,
          requested_product_refund_cents: order.after_sale_cases.reduce(
            (sum, item) =>
              sum + (item.requested_product_refund_cents ?? 0),
            0,
          ),
          requested_delivery_refund_cents: order.after_sale_cases.reduce(
            (sum, item) =>
              sum + (item.requested_delivery_refund_cents ?? 0),
            0,
          ),
          approved_product_refund_cents: order.after_sale_cases.reduce(
            (sum, item) =>
              sum + (item.approved_product_refund_cents ?? 0),
            0,
          ),
          approved_delivery_refund_cents: order.after_sale_cases.reduce(
            (sum, item) =>
              sum + (item.approved_delivery_refund_cents ?? 0),
            0,
          ),
        },
        after_sales: order.after_sale_cases.map(publicAfterSale),
        refunds: order.refunds.map((refund) => ({
          id: refund.id,
          refund_amount_cents: refund.refund_amount_cents,
          product_refund_amount_cents:
            refund.product_refund_amount_cents,
          delivery_refund_amount_cents:
            refund.delivery_refund_amount_cents,
          status: refund.status,
          created_at: refund.created_at,
        })),
        inventory_summary,
        timeline: timeline.map((item) => ({
          id: item.id,
          event_type: item.event_type,
          title: item.title,
          message: item.message,
          actor_type: item.actor_type,
          created_at: item.created_at,
        })),
        created_at: order.created_at,
        paid_at: order.paid_at,
        completed_at: order.completed_at,
      });
    },
  );

  app.get(
    '/api/admin/orders/:id/inventory-summary',
    { preHandler: requireAdminPermission('order.view') },
    async (request, reply) => {
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return fail('ADMIN_UNAUTHORIZED: Admin identity required');
      }
      const { id } = request.params as { id: string };
      const order = await prisma.order.findUnique({ where: { id } });
      if (!order) {
        reply.code(404);
        return fail('订单不存在');
      }
      if (!canAccessOrderDataScope(context, order)) {
        reply.code(403);
        return fail(ADMIN_SCOPE_FORBIDDEN);
      }
      return ok(
        await prisma.$transaction((tx) =>
          getOrderInventorySummary(tx, id),
        ),
      );
    },
  );
}
