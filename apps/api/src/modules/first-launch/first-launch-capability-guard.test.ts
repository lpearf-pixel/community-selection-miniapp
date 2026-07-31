import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';

const originalFirstLaunchMode = process.env.FIRST_LAUNCH_MODE;
const openedApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  if (originalFirstLaunchMode === undefined) {
    delete process.env.FIRST_LAUNCH_MODE;
  } else {
    process.env.FIRST_LAUNCH_MODE = originalFirstLaunchMode;
  }
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('L53 first-launch API capability guard', () => {
  it.each([
    ['GET', '/api/leaders/me/commissions'],
    ['POST', '/api/leaders/me/rewards/convert-credit'],
    ['GET', '/api/leaders/me/withdrawable-commissions'],
    ['GET', '/api/leaders/me/withdrawals'],
    ['GET', '/api/leaders/me/withdrawals/withdrawal-id'],
    ['POST', '/api/leaders/me/withdrawals'],
    ['GET', '/api/leaders/me/dashboard'],
    ['GET', '/api/admin/rewards'],
    ['GET', '/api/admin/withdrawals'],
    ['GET', '/api/admin/tax-records'],
    ['GET', '/api/admin/finance/reconciliation/rewards'],
  ] as const)('rejects disabled leader capability %s %s with the V1 envelope', async (method, url) => {
    process.env.FIRST_LAUNCH_MODE = 'true';
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({ method, url, payload: {} });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      success: false,
      data: null,
      code: 'CAPABILITY_DISABLED',
      message: '首发阶段暂不开放奖励与提现服务',
    });
    expect(response.json().trace_id).toEqual(expect.any(String));
  });

  it('stops reward and withdrawal requests before database side effects', async () => {
    process.env.FIRST_LAUNCH_MODE = 'true';
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 'leader-id',
      openid: 'leader-openid',
      nickname: 'Leader',
      avatar_url: null,
      role: 'leader',
      status: 'active',
    } as any);
    const rewardRead = vi.spyOn(prisma.commission, 'findMany').mockResolvedValue([]);
    const withdrawalRead = vi.spyOn(prisma.withdrawal, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.withdrawalCommission, 'groupBy').mockResolvedValue([] as any);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    await app.inject({
      method: 'GET',
      url: '/api/leaders/me/commissions',
      headers: { 'x-user-id': 'leader-id' },
    });
    await app.inject({
      method: 'GET',
      url: '/api/leaders/me/withdrawals',
      headers: { 'x-user-id': 'leader-id' },
    });

    expect(rewardRead).not.toHaveBeenCalled();
    expect(withdrawalRead).not.toHaveBeenCalled();
  });

  it('keeps the purchase and group-buy API surface outside the disabled route families', async () => {
    process.env.FIRST_LAUNCH_MODE = 'true';
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const [health, products, groupBuys] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/health' }),
      app.inject({ method: 'POST', url: '/api/orders/normal', payload: {} }),
      app.inject({ method: 'POST', url: '/api/orders', payload: {} }),
    ]);

    expect(health.statusCode).toBe(200);
    expect(products.statusCode).not.toBe(503);
    expect(groupBuys.statusCode).not.toBe(503);
  });

  it('does not alter the historical routes when first-launch mode is not active', async () => {
    delete process.env.FIRST_LAUNCH_MODE;
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/commissions',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
  });
});
