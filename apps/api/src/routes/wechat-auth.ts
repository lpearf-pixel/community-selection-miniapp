import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import {
  createPrismaUserSessionStore,
  createUserSessionOwner,
} from '../modules/current-user/user-session-owner.js';
import {
  createWechatLoginClient,
  type WechatLoginClient,
} from '../modules/wechat/wechat-login-client.js';

const AUTH_USER_SELECT = {
  id: true,
  openid: true,
  unionid: true,
  nickname: true,
  avatar_url: true,
  role: true,
  status: true,
} as const satisfies Prisma.UserSelect;

type AuthUser = Prisma.UserGetPayload<{ select: typeof AUTH_USER_SELECT }>;

type AuthDependencies = {
  loginClient: WechatLoginClient;
  upsertWechatUser(input: {
    openid: string;
    unionid: string | null;
  }): Promise<AuthUser>;
  sessionOwner: {
    issue(userId: string): Promise<{ token: string; expires_at: Date }>;
    revoke(token: string): Promise<boolean>;
  };
};

function requiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function defaultDependencies(): AuthDependencies {
  return {
    loginClient: createWechatLoginClient({
      appId: requiredEnv('WECHAT_APP_ID'),
      appSecret: requiredEnv('WECHAT_APP_SECRET'),
    }),
    upsertWechatUser({ openid, unionid }) {
      return prisma.user.upsert({
        where: { openid },
        update: unionid ? { unionid } : {},
        create: {
          openid,
          unionid,
          nickname: '微信用户',
        },
        select: AUTH_USER_SELECT,
      });
    },
    sessionOwner: createUserSessionOwner({
      secret: requiredEnv('USER_SESSION_TOKEN_SECRET'),
      store: createPrismaUserSessionStore(),
    }),
  };
}

function parseCode(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length !== 1 || entries[0]?.[0] !== 'code') return null;
  const value = entries[0][1];
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return code && code.length <= 256 ? code : null;
}

function parseBearer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^Bearer\s+([A-Za-z0-9_-]{16,512})$/i.exec(value.trim())?.[1] ?? null;
}

export function registerWechatAuthRoutes(
  app: FastifyInstance,
  injected?: AuthDependencies,
) {
  app.post('/api/auth/wechat/login', async (request, reply) => {
    const code = parseCode(request.body);
    if (!code) {
      reply.code(400);
      return fail('登录参数无效');
    }
    try {
      const dependencies = injected ?? defaultDependencies();
      const identity = await dependencies.loginClient.exchangeCode(code);
      const user = await dependencies.upsertWechatUser(identity);
      if (user.status !== 'active') {
        reply.code(403);
        return fail('用户状态不可用');
      }
      const session = await dependencies.sessionOwner.issue(user.id);
      return ok({
        token: session.token,
        expires_at: session.expires_at,
        user,
      });
    } catch (error) {
      request.log.warn(
        {
          operation: 'wechat-login',
          error_code:
            error instanceof Error &&
            /^WECHAT_LOGIN_[A-Z0-9_]+$/.test(error.message)
              ? error.message
              : 'WECHAT_LOGIN_FAILED',
        },
        '微信登录失败',
      );
      reply.code(401);
      return fail('微信登录失败，请重试');
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = parseBearer(request.headers.authorization);
    if (!token) {
      reply.code(401);
      return fail('缺少用户身份');
    }
    try {
      const dependencies = injected ?? defaultDependencies();
      await dependencies.sessionOwner.revoke(token);
      return ok({ logged_out: true });
    } catch {
      reply.code(401);
      return fail('用户登录已失效');
    }
  });
}
