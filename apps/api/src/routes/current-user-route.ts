import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import {
  mapCurrentUserRouteError,
  requireCurrentLeader,
  resolveCurrentUser,
  safeErrorLogMetadata,
  type CurrentLeaderIdentity,
  type CurrentUserIdentity,
} from '../modules/current-user/current-user-security.js';

export async function withCurrentUser<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  fallbackMessage: string,
  handler: (user: CurrentUserIdentity) => Promise<T>,
) {
  try {
    const user = await resolveCurrentUser(request.headers);
    return ok(await handler(user));
  } catch (error) {
    const mapped = mapCurrentUserRouteError(error, fallbackMessage);
    if (mapped.statusCode === 500) {
      request.log.error(
        safeErrorLogMetadata('current-user-route', error),
        fallbackMessage,
      );
    }
    reply.code(mapped.statusCode);
    return fail(mapped.message);
  }
}

export async function withCurrentLeader<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  fallbackMessage: string,
  handler: (leader: CurrentLeaderIdentity) => Promise<T>,
) {
  try {
    const user = await resolveCurrentUser(request.headers);
    requireCurrentLeader(user);
    return ok(await handler(user));
  } catch (error) {
    const mapped = mapCurrentUserRouteError(error, fallbackMessage);
    if (mapped.statusCode === 500) {
      request.log.error(
        safeErrorLogMetadata('current-user-route', error),
        fallbackMessage,
      );
    }
    reply.code(mapped.statusCode);
    return fail(mapped.message);
  }
}
