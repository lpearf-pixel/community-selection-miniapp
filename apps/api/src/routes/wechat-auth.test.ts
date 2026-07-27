import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWechatAuthRoutes } from './wechat-auth.js';

const apps: ReturnType<typeof Fastify>[] = [];

function buildTestApp(options: {
  userStatus?: string;
  exchangeCode?: ReturnType<typeof vi.fn>;
} = {}) {
  const app = Fastify({ logger: false });
  apps.push(app);
  const exchangeCode =
    options.exchangeCode ??
    vi.fn(async () => ({ openid: 'openid-a', unionid: 'union-a' }));
  const upsertWechatUser = vi.fn(async () => ({
    id: 'user-a',
    openid: 'openid-a',
    unionid: 'union-a',
    nickname: '微信用户',
    avatar_url: null,
    role: 'customer' as const,
    status: options.userStatus ?? 'active',
  }));
  const issue = vi.fn(async () => ({
    token: 'plain-session-token',
    expires_at: new Date('2026-08-27T00:00:00.000Z'),
  }));
  const revoke = vi.fn(async () => true);
  registerWechatAuthRoutes(app, {
    loginClient: { exchangeCode },
    upsertWechatUser,
    sessionOwner: { issue, revoke },
  });
  return { app, exchangeCode, upsertWechatUser, issue, revoke };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('WeChat auth routes', () => {
  it('strictly exchanges a code and issues a server session', async () => {
    const { app, exchangeCode, upsertWechatUser, issue } = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/wechat/login',
      payload: { code: 'code-a' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        token: 'plain-session-token',
        user: { id: 'user-a', openid: 'openid-a' },
      },
    });
    expect(exchangeCode).toHaveBeenCalledWith('code-a');
    expect(upsertWechatUser).toHaveBeenCalledWith({
      openid: 'openid-a',
      unionid: 'union-a',
    });
    expect(issue).toHaveBeenCalledWith('user-a');
  });

  it('rejects unknown fields, empty codes, and disabled users', async () => {
    const first = buildTestApp();
    const unknown = await first.app.inject({
      method: 'POST',
      url: '/api/auth/wechat/login',
      payload: { code: 'code-a', openid: 'forged' },
    });
    expect(unknown.statusCode).toBe(400);
    expect(first.exchangeCode).not.toHaveBeenCalled();

    const empty = await first.app.inject({
      method: 'POST',
      url: '/api/auth/wechat/login',
      payload: { code: ' ' },
    });
    expect(empty.statusCode).toBe(400);

    const disabled = buildTestApp({ userStatus: 'inactive' });
    const blocked = await disabled.app.inject({
      method: 'POST',
      url: '/api/auth/wechat/login',
      payload: { code: 'code-a' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(disabled.issue).not.toHaveBeenCalled();
  });

  it('revokes only the Bearer token supplied to logout', async () => {
    const { app, revoke } = buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'Bearer plain-session-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(revoke).toHaveBeenCalledWith('plain-session-token');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(missing.statusCode).toBe(401);
  });
});
