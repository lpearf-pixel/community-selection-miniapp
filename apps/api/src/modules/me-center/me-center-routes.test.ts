import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';
import { requireCurrentLeader } from '../current-user/current-user-security.js';

const openedApps: ReturnType<typeof buildApp>[] = [];
type UserFindUniqueResult = ReturnType<typeof prisma.user.findUnique>;

const headerCustomer = {
  id: 'l47-header-customer',
  openid: 'l47-header-customer-openid',
  nickname: 'Header Customer',
  avatar_url: null,
  role: 'customer',
  status: 'active',
};

const queryLeader = {
  id: 'l47-query-leader',
  openid: 'l47-query-leader-openid',
  nickname: 'Query Leader',
  avatar_url: null,
  role: 'leader',
  status: 'active',
};

function prismaUserResult(value: unknown): UserFindUniqueResult {
  return Promise.resolve(value) as unknown as UserFindUniqueResult;
}

function mockConflictingIdentityUsers(): void {
  vi.spyOn(prisma.user, 'findUnique').mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (where.id === headerCustomer.id || where.openid === headerCustomer.openid) {
      return prismaUserResult(headerCustomer);
    }
    if (where.id === queryLeader.id || where.openid === queryLeader.openid) {
      return prismaUserResult(queryLeader);
    }
    return prismaUserResult(null);
  });
}

function mockPersonalCenterAggregates(): void {
  vi.spyOn(prisma.order, 'count').mockResolvedValue(0);
  vi.spyOn(prisma.afterSaleCase, 'count').mockResolvedValue(0);
}

function mockLeaderCenterAggregates(): void {
  vi.spyOn(prisma.groupBuy, 'count').mockResolvedValue(0);
  vi.spyOn(prisma.commission, 'aggregate').mockResolvedValue({
    _sum: { final_amount_cents: null },
  } as any);
  vi.spyOn(prisma.rewardLedger, 'groupBy').mockResolvedValue([] as any);
  vi.spyOn(prisma.withdrawal, 'aggregate').mockResolvedValue({
    _sum: { amount_cents: null },
  } as any);
  vi.spyOn(prisma.withdrawal, 'count').mockResolvedValue(0);
  vi.spyOn(prisma.withdrawal, 'findMany').mockResolvedValue([]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('L47 center routes', () => {
  it('registers both center endpoints and returns 401 without user identity', async () => {
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/me/center-summary',
    });
    const leaderResponse = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/center-summary',
    });

    expect(meResponse.statusCode).toBe(401);
    expect(leaderResponse.statusCode).toBe(401);
    expect(meResponse.json()).toMatchObject({ success: false });
    expect(leaderResponse.json()).toMatchObject({ success: false });
  });

  it('rejects query-only identities for both center endpoints', async () => {
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/me/center-summary?user_id=l47-query-only-user',
    });
    const leaderResponse = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/center-summary?openid=l47-query-only-openid',
    });

    expect(meResponse.statusCode).toBe(401);
    expect(leaderResponse.statusCode).toBe(401);
    expect(meResponse.json()).toMatchObject({ success: false, message: '缺少用户身份' });
    expect(leaderResponse.json()).toMatchObject({ success: false, message: '缺少用户身份' });
  });

  it('uses the x-openid identity instead of a conflicting query user_id for the personal center', async () => {
    mockConflictingIdentityUsers();
    mockPersonalCenterAggregates();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/me/center-summary?user_id=${queryLeader.id}`,
      headers: { 'x-openid': headerCustomer.openid },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        profile: {
          user_id: headerCustomer.id,
          role: 'user',
        },
      },
    });
  });

  it('does not let a conflicting query user_id upgrade an x-openid customer into a leader', async () => {
    mockConflictingIdentityUsers();
    mockLeaderCenterAggregates();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/center-summary?user_id=${queryLeader.id}`,
      headers: { 'x-openid': headerCustomer.openid },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '仅开团人可访问',
    });
  });

  it('sanitizes unexpected personal-center failures as HTTP 500', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
      new Error('Prisma connection failed at secret-host'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me/center-summary',
      headers: { 'x-user-id': 'l47-error-user' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ success: false, message: '个人中心加载失败' });
    expect(response.body).not.toContain('Prisma');
    expect(response.body).not.toContain('secret-host');
  });

  it('sanitizes unexpected leader-center failures as HTTP 500', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
      new Error('Prisma connection failed at secret-host'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/center-summary',
      headers: { 'x-user-id': 'l47-error-leader' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ success: false, message: '团长中心加载失败' });
    expect(response.body).not.toContain('Prisma');
    expect(response.body).not.toContain('secret-host');
  });

  it('rejects non-leaders with 403 and accepts leaders', () => {
    expect(() => requireCurrentLeader(headerCustomer as any)).toThrowError('仅开团人可访问');

    try {
      requireCurrentLeader(headerCustomer as any);
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(403);
    }

    expect(() => requireCurrentLeader(queryLeader as any)).not.toThrow();
  });
});
