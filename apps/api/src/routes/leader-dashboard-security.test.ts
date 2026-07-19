import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

const leaderA = {
  id: 'l48-dashboard-leader-a',
  openid: 'l48-dashboard-openid-a',
  nickname: 'Dashboard Leader A',
  avatar_url: null,
  role: 'leader',
  status: 'active',
};

const leaderB = {
  ...leaderA,
  id: 'l48-dashboard-leader-b',
  openid: 'l48-dashboard-openid-b',
  nickname: 'Dashboard Leader B',
};

const customer = {
  ...leaderA,
  id: 'l48-dashboard-customer',
  openid: 'l48-dashboard-customer-openid',
  role: 'customer',
};

function userResult(value: unknown): ReturnType<typeof prisma.user.findUnique> {
  return Promise.resolve(value) as unknown as ReturnType<typeof prisma.user.findUnique>;
}

function mockIdentityUsers(): void {
  vi.spyOn(prisma.user, 'findUnique').mockImplementation((args: any) => {
    const where = args?.where ?? {};
    for (const user of [leaderA, leaderB, customer]) {
      if (where.id === user.id || where.openid === user.openid) {
        return userResult(user);
      }
    }
    return userResult(null);
  });
}

function mockDashboardRows(): void {
  vi.spyOn(prisma.groupBuy, 'count').mockResolvedValue(0);
  vi.spyOn(prisma.order, 'findMany').mockResolvedValue([]);
  vi.spyOn(prisma.commission, 'findMany').mockResolvedValue([]);
  vi.spyOn(prisma.rewardConversion, 'findMany').mockResolvedValue([]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('L48 leader dashboard route security', () => {
  it('rejects query-only identity with 401 before reading dashboard data', async () => {
    mockIdentityUsers();
    mockDashboardRows();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/dashboard?leader_user_id=${leaderA.id}&openid=${leaderA.openid}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
    expect(prisma.groupBuy.count).not.toHaveBeenCalled();
  });

  it('uses the header leader when query identity conflicts', async () => {
    mockIdentityUsers();
    mockDashboardRows();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/dashboard?leader_user_id=${leaderB.id}&openid=${leaderB.openid}`,
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.groupBuy.count).toHaveBeenCalledWith({
      where: {
        leader_user_id: leaderA.id,
        status: { in: ['pending', 'success', 'preparing', 'ready'] },
      },
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        leader_user_id: leaderA.id,
        order_status: {
          in: ['paid', 'grouped', 'preparing', 'ready', 'picked', 'completed'],
        },
      },
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        active_group_buys: 0,
        today_orders: 0,
        today_amount_cents: 0,
        total_orders: 0,
        total_amount_cents: 0,
        pending_commission_cents: 0,
        available_commission_cents: 0,
        withdrawing_commission_cents: 0,
        withdrawn_commission_cents: 0,
        converted_credit_cents: 0,
      },
    });
  });

  it('rejects a non-leader with 403 before reading dashboard data', async () => {
    mockIdentityUsers();
    mockDashboardRows();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/dashboard',
      headers: { 'x-user-id': customer.id },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '仅开团人可访问',
    });
    expect(prisma.groupBuy.count).not.toHaveBeenCalled();
  });

  it('returns a fixed 500 without exposing an unknown dashboard error', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.groupBuy, 'count').mockRejectedValue(
      new Error('dashboard-database-secret'),
    );
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.commission, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.rewardConversion, 'findMany').mockResolvedValue([]);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/dashboard',
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '查询开团人看板失败',
    });
    expect(response.body).not.toContain('dashboard-database-secret');
  });
});
