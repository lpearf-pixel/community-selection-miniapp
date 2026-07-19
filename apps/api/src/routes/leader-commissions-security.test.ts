import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

const leaderA = {
  id: 'l48-commission-leader-a',
  openid: 'l48-commission-openid-a',
  nickname: 'Commission Leader A',
  avatar_url: null,
  role: 'leader',
  status: 'active',
};

const leaderB = {
  ...leaderA,
  id: 'l48-commission-leader-b',
  openid: 'l48-commission-openid-b',
  nickname: 'Commission Leader B',
};

const customer = {
  ...leaderA,
  id: 'l48-commission-customer',
  openid: 'l48-commission-customer-openid',
  role: 'customer',
};

const inactiveLeader = {
  ...leaderA,
  id: 'l48-commission-inactive',
  openid: 'l48-commission-inactive-openid',
  status: 'inactive',
};

const commissionA = {
  id: 'l48-commission-a',
  leader_user_id: leaderA.id,
  order_id: 'l48-commission-order-a',
  group_buy_id: 'l48-commission-group-a',
  base_amount_cents: 2000,
  estimated_amount_cents: 700,
  deduct_amount_cents: 0,
  final_amount_cents: 700,
  status: 'available',
  available_at: new Date('2026-07-19T00:00:00.000Z'),
  created_at: new Date('2026-07-18T00:00:00.000Z'),
  updated_at: new Date('2026-07-19T00:00:00.000Z'),
  review_status: 'unreviewed',
  review_note: 'internal-review-secret',
  reviewed_by_admin_id: 'internal-admin-secret',
  order: { order_no: 'L48-COMMISSION-ORDER-A' },
  group_buy: {
    community_id: 'l48-community-a',
    product: { name: '安全测试商品' },
    community: { name: '安全测试社区' },
  },
};

function userResult(value: unknown): ReturnType<typeof prisma.user.findUnique> {
  return Promise.resolve(value) as unknown as ReturnType<typeof prisma.user.findUnique>;
}

function mockIdentityUsers(): void {
  vi.spyOn(prisma.user, 'findUnique').mockImplementation((args: any) => {
    const where = args?.where ?? {};
    for (const user of [leaderA, leaderB, customer, inactiveLeader]) {
      if (where.id === user.id || where.openid === user.openid) {
        return userResult(user);
      }
    }
    return userResult(null);
  });
}

function mockRewardBalance(amountCents = 700): void {
  vi.spyOn(prisma, '$transaction').mockImplementation(
    (async (callback: (tx: any) => Promise<unknown>) =>
      callback({
        rewardLedger: {
          findMany: vi.fn().mockResolvedValue([
            { direction: 'in', amount_cents: amountCents },
          ]),
        },
      })) as any,
  );
}

function collectKeys(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output.push(key);
    collectKeys(child, output);
  }
  return output;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('L48 leader commission route security', () => {
  it('rejects query-only leader identity with 401 before reading commissions', async () => {
    mockIdentityUsers();
    const findMany = vi.spyOn(prisma.commission, 'findMany');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/commissions?openid=${leaderA.openid}&leader_user_id=${leaderA.id}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('uses the header leader when query identity conflicts and returns a public DTO', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.commission, 'findMany').mockResolvedValue([
      commissionA as any,
    ]);
    mockRewardBalance();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/commissions?openid=${leaderB.openid}&leader_user_id=${leaderB.id}`,
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.commission.findMany).toHaveBeenCalledWith({
      where: { leader_user_id: leaderA.id },
      include: {
        order: { select: { order_no: true } },
        group_buy: {
          include: {
            product: { select: { name: true } },
            community: { select: { name: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        summary: {
          available_amount_cents: 700,
          withdrawable_amount_cents: 700,
        },
        items: [
          {
            commission_id: commissionA.id,
            order_id: commissionA.order_id,
            final_amount_cents: 700,
            status: 'available',
          },
        ],
      },
    });

    const keys = collectKeys(response.json());
    for (const key of [
      'leader_user_id',
      'review_note',
      'reviewed_by_admin_id',
      'admin_remark',
      'tax_remark',
    ]) {
      expect(keys).not.toContain(key);
    }
    expect(response.body).not.toContain('internal-review-secret');
    expect(response.body).not.toContain('internal-admin-secret');
  });

  it('rejects customers with 403 before reading commissions', async () => {
    mockIdentityUsers();
    const findMany = vi.spyOn(prisma.commission, 'findMany');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/commissions',
      headers: { 'x-user-id': customer.id },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '仅开团人可访问',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects inactive leaders with 403 before reading commissions', async () => {
    mockIdentityUsers();
    const findMany = vi.spyOn(prisma.commission, 'findMany');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/commissions',
      headers: { 'x-user-id': inactiveLeader.id },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '用户状态不可用',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns a fixed 500 without exposing an unknown Prisma error', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.commission, 'findMany').mockRejectedValue(
      new Error('unique-commission-db-secret'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/commissions',
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '查询开团服务奖励失败',
    });
    expect(response.body).not.toContain('unique-commission-db-secret');
  });
});
