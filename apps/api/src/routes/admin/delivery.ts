import type { FastifyInstance } from 'fastify';
import { contractFail, contractOk, fail, ok } from '@community-selection/shared';
import { requireAdminPermission, requireAdminPermissionV1, resolveAdminAccessContext } from '../../modules/admin-access/admin-access-control.js';
import { disableDeliveryRuleConfig, getDeliveryRule, getDeliveryRuleConfig, listDeliveryRuleConfigs, upsertDeliveryRuleConfig } from '../../modules/delivery/delivery-rule-service.js';
import { getDeliveryReservation, listDeliveryProviders, listDeliveryReservations, reserveDelivery } from '../../modules/delivery/delivery-service.js';
import { parseAdminDeliveryStatusCommand } from '../../modules/delivery/admin-delivery-status-command.js';
import { AdminDeliveryStatusError, executeAdminDeliveryStatusCommand } from '../../modules/delivery/admin-delivery-status-executor.js';
import type { DeliveryMode, DeliveryProvider, DeliveryStatus } from '../../modules/delivery/delivery-types.js';

type DeliveryQuery = { status?: DeliveryStatus; provider?: DeliveryProvider; pickup_store_id?: string; community_id?: string; keyword?: string; page?: string; page_size?: string };
type RuleQuery = { pickup_store_id?: string };
type ReserveBody = { provider: DeliveryProvider; delivery_mode: DeliveryMode; remark?: string };
function bodyError(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function actor(request: any) { return { admin_user_id: request.admin_user?.id ?? null, ip_address: request.ip, user_agent: request.headers?.['user-agent'] ?? null }; }

export function registerAdminDeliveryRoutes(app: FastifyInstance) {
  app.get('/api/admin/delivery/rules', { preHandler: requireAdminPermission(['order.view', 'pickup.verify']) }, async (request) => ok(await getDeliveryRule({ pickup_store_id: (request.query as RuleQuery).pickup_store_id })));
  app.get('/api/admin/delivery/rule-configs', { preHandler: requireAdminPermission(['system.manage', 'order.manage']) }, async (request, reply) => { try { return ok(await listDeliveryRuleConfigs(request.query as RuleQuery)); } catch (error) { reply.code(400); return fail(bodyError(error, '配送规则配置查询失败')); } });
  app.post('/api/admin/delivery/rule-configs', { preHandler: requireAdminPermission(['system.manage', 'order.manage']) }, async (request, reply) => { try { return ok(await upsertDeliveryRuleConfig(request.body)); } catch (error) { reply.code(400); return fail(bodyError(error, '配送规则配置保存失败')); } });
  app.get('/api/admin/delivery/rule-configs/:id', { preHandler: requireAdminPermission(['system.manage', 'order.manage']) }, async (request, reply) => { try { return ok(await getDeliveryRuleConfig((request.params as { id: string }).id)); } catch (error) { reply.code(400); return fail(bodyError(error, '配送规则配置详情查询失败')); } });
  app.post('/api/admin/delivery/rule-configs/:id/disable', { preHandler: requireAdminPermission(['system.manage', 'order.manage']) }, async (request, reply) => { try { return ok(await disableDeliveryRuleConfig((request.params as { id: string }).id)); } catch (error) { reply.code(400); return fail(bodyError(error, '配送规则配置禁用失败')); } });
  app.get('/api/admin/delivery/orders', { preHandler: requireAdminPermission(['order.view', 'pickup.verify']) }, async (request, reply) => {
    try { return ok(await listDeliveryReservations(request.query as DeliveryQuery, resolveAdminAccessContext(request)!)); } catch (error) { reply.code(400); return fail(error instanceof Error ? error.message : '配送订单查询失败'); }
  });
  app.get('/api/admin/delivery/orders/:id', { preHandler: requireAdminPermission(['order.view', 'pickup.verify']) }, async (request, reply) => {
    try { return ok(await getDeliveryReservation((request.params as { id: string }).id, resolveAdminAccessContext(request)!)); } catch (error: any) { reply.code(error?.statusCode ?? 400); return fail(error instanceof Error ? error.message : '配送详情查询失败'); }
  });
  app.post('/api/admin/delivery/orders/:id/reserve', { preHandler: requireAdminPermission('order.manage') }, async (request, reply) => {
    try { return ok(await reserveDelivery((request.params as { id: string }).id, request.body as ReserveBody, actor(request), resolveAdminAccessContext(request)!)); } catch (error: any) { reply.code(error?.statusCode ?? 400); return fail(error instanceof Error ? error.message : '配送预留失败'); }
  });
  app.post(
    '/api/admin/delivery/orders/:id/status',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('order.manage'),
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
      const parsed = parseAdminDeliveryStatusCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }
      const orderId = (request.params as { id: string }).id;
      try {
        const result = await executeAdminDeliveryStatusCommand({
          order_id: orderId,
          command: parsed.value,
          context,
          admin_meta: actor(request),
        });
        return contractOk(result, {
          code: 'ADMIN_DELIVERY_STATUS_UPDATED',
          message: '',
          traceId,
        });
      } catch (error) {
        if (error instanceof AdminDeliveryStatusError) {
          reply.code(error.statusCode);
          return contractFail({
            code: error.code,
            message: error.message,
            traceId,
          });
        }
        request.log.error({
          error_name: error instanceof Error ? error.name : 'UnknownError',
          order_id: orderId,
          trace_id: traceId,
        });
        reply.code(500);
        return contractFail({
          code: 'ADMIN_DELIVERY_STATUS_UPDATE_FAILED',
          message: '配送状态更新失败',
          traceId,
        });
      }
    },
  );
  app.get('/api/admin/delivery/providers', { preHandler: requireAdminPermission('order.view') }, async () => ok(listDeliveryProviders()));
}
