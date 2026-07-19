import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db.js';
import { publicCurrentUserError } from '../modules/current-user/current-user-security.js';
import { withCurrentLeader, withCurrentUser } from './current-user-route.js';

const openedApps: ReturnType<typeof Fastify>[] = [];

const activeCustomer = {
  id: 'wrapper-customer',
  openid: 'wrapper-customer-openid',
  role: 'customer',
  status: 'active',
  nickname: 'Wrapper Customer',
  avatar_url: null,
};

const activeLeader = {
  ...activeCustomer,
  id: 'wrapper-leader',
  openid: 'wrapper-leader-openid',
  role: 'leader',
};

function userResult(value: unknown): ReturnType<typeof prisma.user.findUnique> {
  return Promise.resolve(value) as unknown as ReturnType<typeof prisma.user.findUnique>;
}

function buildTestApp() {
  const app = Fastify({ logger: false });
  openedApps.push(app);

  app.get('/test/me', (request, reply) =>
    withCurrentUser(request, reply, '测试操作失败', async (user) => ({
      user_id: user.id,
    })),
  );
  app.get('/test/me/public-error', (request, reply) =>
    withCurrentUser(request, reply, '测试操作失败', async () => {
      throw publicCurrentUserError('输入不合法', 400);
    }),
  );
  app.get('/test/me/unknown-error', (request, reply) =>
    withCurrentUser(request, reply, '测试操作失败', async () => {
      throw new Error('database-host-secret');
    }),
  );
  app.get('/test/leader', (request, reply) =>
    withCurrentLeader(request, reply, '团长测试失败', async (leader) => ({
      leader_id: leader.id,
    })),
  );

  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('shared current-user route wrappers', () => {
  it('returns 401 without an identity header', async () => {
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/test/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
  });

  it('returns 403 for an inactive user before invoking the handler', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockReturnValue(
      userResult({ ...activeCustomer, status: 'inactive' }),
    );
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test/me',
      headers: { 'x-user-id': activeCustomer.id },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '用户状态不可用',
    });
  });

  it('returns a fixed 500 for an unknown handler error', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockReturnValue(userResult(activeCustomer));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test/me/unknown-error',
      headers: { 'x-user-id': activeCustomer.id },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '测试操作失败',
    });
    expect(response.body).not.toContain('database-host-secret');
  });

  it('preserves an explicit public 400 error', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockReturnValue(userResult(activeCustomer));
    const app = buildTestApp();
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test/me/public-error',
      headers: { 'x-user-id': activeCustomer.id },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: '输入不合法',
    });
  });

  it('rejects customers and accepts leaders through the leader wrapper', async () => {
    const findUnique = vi.spyOn(prisma.user, 'findUnique');
    findUnique.mockReturnValueOnce(userResult(activeCustomer));
    findUnique.mockReturnValueOnce(userResult(activeLeader));
    const app = buildTestApp();
    await app.ready();

    const customerResponse = await app.inject({
      method: 'GET',
      url: '/test/leader',
      headers: { 'x-user-id': activeCustomer.id },
    });
    const leaderResponse = await app.inject({
      method: 'GET',
      url: '/test/leader',
      headers: { 'x-user-id': activeLeader.id },
    });

    expect(customerResponse.statusCode).toBe(403);
    expect(customerResponse.json()).toMatchObject({
      success: false,
      message: '仅开团人可访问',
    });
    expect(leaderResponse.statusCode).toBe(200);
    expect(leaderResponse.json()).toMatchObject({
      success: true,
      data: { leader_id: activeLeader.id },
    });
  });
});
