import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

const leaderA = {
  id: 'l48-withdrawal-leader-a',
  openid: 'l48-withdrawal-openid-a',
  nickname: 'Leader A',
  avatar_url: null,
  role: 'leader',
  status: 'active',
};

const leaderB = {
  ...leaderA,
  id: 'l48-withdrawal-leader-b',
  openid: 'l48-withdrawal-openid-b',
  nickname: 'Leader B',
};

const customer = {
  ...leaderA,
  id: 'l48-withdrawal-customer',
  openid: 'l48-withdrawal-customer-openid',
  nickname: 'Customer',
  role: 'customer',
};

const rejectedWithdrawal = {
  id: 'l48-withdrawal-rejected',
  leader_user_id: leaderA.id,
  client_request_id: 'l48-withdrawal-request-1',
  amount_cents: 3200,
  status: 'rejected',
  created_at: new Date('2026-07-19T00:00:00.000Z'),
  reviewed_at: new Date('2026-07-20T00:00:00.000Z'),
  processed_at: null,
  admin_remark: '内部拒绝原因-unique-secret',
  manual_reference: 'BANK-SECRET-9988',
  tax_remark: '内部税务备注',
  reviewed_by_admin_id: 'admin-secret-id',
  processed_by_admin_id: null,
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

describe('L48 leader withdrawal route security', () => {
  it('rejects query-only identity with 401', async () => {
    mockIdentityUsers();
    const findMany = vi.spyOn(prisma.withdrawal, 'findMany');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/withdrawals?openid=${leaderA.openid}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('accepts x-user-id for an active leader', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.withdrawal, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.withdrawalCommission, 'groupBy').mockResolvedValue([] as any);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/withdrawals',
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ success: true, data: [] });
    expect(prisma.withdrawal.findMany).toHaveBeenCalledWith({
      where: { leader_user_id: leaderA.id },
      orderBy: { created_at: 'desc' },
    });
  });

  it('returns 403 for a customer on every leader withdrawal endpoint', async () => {
    mockIdentityUsers();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const requests = [
      { method: 'GET', url: '/api/leaders/me/withdrawals' },
      { method: 'GET', url: '/api/leaders/me/withdrawals/withdrawal-id' },
      { method: 'GET', url: '/api/leaders/me/withdrawable-commissions' },
      {
        method: 'POST',
        url: '/api/leaders/me/withdrawals',
        payload: { client_request_id: 'request-id', commission_ids: ['commission-id'] },
      },
    ] as const;

    for (const request of requests) {
      const response = await app.inject({
        ...request,
        headers: { 'x-user-id': customer.id },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        success: false,
        message: '仅开团人可访问',
      });
    }
  });

  it('ignores body identity and scopes commission selection to the header leader', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.withdrawal, 'findUnique').mockResolvedValue(null);
    const commissionFindMany = vi.fn().mockResolvedValue([]);
    const fakeTx = {
      commission: { findMany: commissionFindMany },
    } as any;
    vi.spyOn(prisma, '$transaction').mockImplementation(
      (async (callback: (tx: any) => Promise<unknown>) => callback(fakeTx)) as any,
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/withdrawals',
      headers: { 'x-user-id': leaderA.id },
      payload: {
        leader_user_id: leaderB.id,
        openid: leaderB.openid,
        client_request_id: 'l48-body-conflict-request',
        commission_ids: ['l48-commission-a'],
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      message: '存在不可提现或已占用的开团服务奖励',
    });
    expect(commissionFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['l48-commission-a'] },
        leader_user_id: leaderA.id,
        status: 'available',
        withdrawal_id: null,
        final_amount_cents: { gt: 0 },
      },
      orderBy: { created_at: 'asc' },
    });
  });

  it('returns 404 when a leader requests another leader withdrawal', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.withdrawal, 'findFirst').mockResolvedValue(null);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/leaders/me/withdrawals/${rejectedWithdrawal.id}`,
      headers: { 'x-user-id': leaderB.id },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      message: '提现申请不存在',
    });
    expect(prisma.withdrawal.findFirst).toHaveBeenCalledWith({
      where: { id: rejectedWithdrawal.id, leader_user_id: leaderB.id },
    });
  });

  it('returns a fixed 500 for an unknown Prisma error', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.withdrawal, 'findMany').mockRejectedValue(
      new Error('unique-withdrawal-db-secret'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/withdrawals',
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '查询提现申请失败',
    });
    expect(response.body).not.toContain('unique-withdrawal-db-secret');
  });

  it('maps a message-prefixed ledger mismatch from an unknown error to the fixed 500 boundary', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.withdrawal, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma, '$transaction').mockImplementation(
      (async () => {
        throw new Error(
          'LEDGER_MISMATCH:{"mismatches":[{"commission_id":"unknown-secret"}]}',
        );
      }) as any,
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/withdrawals',
      headers: { 'x-user-id': leaderA.id },
      payload: {
        client_request_id: 'l48-unknown-ledger-prefix',
        commission_ids: ['l48-commission-a'],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '提交提现申请失败',
    });
    expect(response.body).not.toContain('unknown-secret');
  });

  it('returns a safe leader DTO without admin, tax, or raw reference fields', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma.withdrawal, 'findMany').mockResolvedValue([
      rejectedWithdrawal as any,
    ]);
    vi.spyOn(prisma.withdrawalCommission, 'groupBy').mockResolvedValue([
      {
        withdrawal_id: rejectedWithdrawal.id,
        _count: { _all: 2 },
      },
    ] as any);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/leaders/me/withdrawals',
      headers: { 'x-user-id': leaderA.id },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: [
        {
          withdrawal_id: rejectedWithdrawal.id,
          commission_count: 2,
          rejection_reason: '提现申请未通过，请联系平台',
          manual_reference_masked: 'BA***88',
        },
      ],
    });

    const keys = collectKeys(response.json());
    for (const key of [
      'admin_remark',
      'manual_reference',
      'tax_remark',
      'reviewed_by_admin_id',
      'processed_by_admin_id',
    ]) {
      expect(keys).not.toContain(key);
    }
    expect(response.body).not.toContain('内部拒绝原因-unique-secret');
    expect(response.body).not.toContain('BANK-SECRET-9988');
    expect(response.body).not.toContain('内部税务备注');
    expect(response.body).not.toContain('admin-secret-id');
  });
});
