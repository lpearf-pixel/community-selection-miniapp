import { contractFail } from '@community-selection/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

const disabledRoutePatterns = [
  /^\/api\/leaders\/me\/commissions$/,
  /^\/api\/leaders\/me\/rewards(?:\/|$)/,
  /^\/api\/leaders\/me\/withdrawable-commissions$/,
  /^\/api\/leaders\/me\/withdrawals(?:\/|$)/,
  /^\/api\/leaders\/me\/dashboard$/,
  /^\/api\/admin\/rewards(?:\/|$)/,
  /^\/api\/admin\/commissions(?:\/|$)/,
  /^\/api\/admin\/withdrawals(?:\/|$)/,
  /^\/api\/admin\/tax-records(?:\/|$)/,
  /^\/api\/admin\/finance\/reconciliation\/rewards$/,
] as const;

export function isFirstLaunchCapabilityRoute(path: string): boolean {
  return disabledRoutePatterns.some((pattern) => pattern.test(path));
}

export async function enforceFirstLaunchCapabilityGuard(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (process.env.FIRST_LAUNCH_MODE !== 'true') return;

  const routePath = request.routeOptions.url ?? request.url.split('?', 1)[0];
  if (!isFirstLaunchCapabilityRoute(routePath)) return;

  reply.code(503).header('cache-control', 'no-store').send(
    contractFail({
      code: 'CAPABILITY_DISABLED',
      message: '首发阶段暂不开放奖励与提现服务',
      traceId: String(request.id),
    }),
  );
}
