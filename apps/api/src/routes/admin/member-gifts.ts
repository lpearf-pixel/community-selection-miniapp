import type { FastifyInstance, FastifyReply } from 'fastify';
import { contractFail, contractOk } from '@community-selection/shared';
import {
  type AdminAccessContext,
  requireAdminPermissionV1,
  resolveAdminAccessContext,
} from '../../modules/admin-access/admin-access-control.js';

type LossReason = 'damaged' | 'lost' | 'unsellable';

export type AdminMemberGiftRouteService = {
  list(input: { status?: string; context: AdminAccessContext }): Promise<unknown>;
  deliver(input: {
    claimId: string;
    context: AdminAccessContext;
    idempotencyKey: string;
  }): Promise<unknown>;
  writeOff(input: {
    claimId: string;
    context: AdminAccessContext;
    idempotencyKey: string;
    reason: LossReason;
  }): Promise<unknown>;
};

function invalidCommand() {
  return { code: 'INVALID_ADMIN_MEMBER_GIFT_COMMAND', message: '赠品管理命令不合法' };
}

function exactStrings(body: unknown, keys: readonly string[]) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => typeof value[key] !== 'string' || !(value[key] as string).trim())) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, (value[key] as string).trim()])) as Record<string, string>;
}

function errorResponse(reply: FastifyReply, traceId: string, error: unknown) {
  const statusCode = error && typeof error === 'object' && 'statusCode' in error && Number.isInteger(error.statusCode)
    ? Number(error.statusCode)
    : 500;
  reply.code(statusCode);
  return contractFail({
    code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'ADMIN_MEMBER_GIFT_COMMAND_FAILED',
    message: error instanceof Error ? error.message : '赠品管理命令执行失败',
    traceId,
  });
}

export function registerAdminMemberGiftRoutes(
  app: FastifyInstance,
  service: AdminMemberGiftRouteService,
) {
  const guard = requireAdminPermissionV1('order.manage');

  app.get('/api/admin/member-gift-claims', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request) => contractOk(
    await service.list({
      ...(request.query as { status?: string }),
      context: resolveAdminAccessContext(request)!,
    }),
    { code: 'ADMIN_MEMBER_GIFT_LIST', message: '', traceId: String(request.id) },
  ));

  app.post('/api/admin/member-gift-claims/:id/deliver', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request, reply) => {
    const traceId = String(request.id);
    const body = exactStrings(request.body, ['idempotency_key']);
    if (!body) {
      reply.code(400);
      return contractFail({ ...invalidCommand(), traceId });
    }
    try {
      const data = await service.deliver({
        claimId: (request.params as { id: string }).id,
        context: resolveAdminAccessContext(request)!,
        idempotencyKey: body.idempotency_key,
      });
      return contractOk(data, { code: 'ADMIN_MEMBER_GIFT_DELIVERED', message: '赠品已交付', traceId });
    } catch (error) {
      return errorResponse(reply, traceId, error);
    }
  });

  app.post('/api/admin/member-gift-claims/:id/write-off', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request, reply) => {
    const traceId = String(request.id);
    const body = exactStrings(request.body, ['reason', 'idempotency_key']);
    const reasons = new Set<LossReason>(['damaged', 'lost', 'unsellable']);
    if (!body || !reasons.has(body.reason as LossReason)) {
      reply.code(400);
      return contractFail({ ...invalidCommand(), traceId });
    }
    try {
      const data = await service.writeOff({
        claimId: (request.params as { id: string }).id,
        context: resolveAdminAccessContext(request)!,
        reason: body.reason as LossReason,
        idempotencyKey: body.idempotency_key,
      });
      return contractOk(data, { code: 'ADMIN_MEMBER_GIFT_WRITTEN_OFF', message: '赠品已报损', traceId });
    } catch (error) {
      return errorResponse(reply, traceId, error);
    }
  });
}
