import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

const leaderA = {
  id: 'l48-reward-leader-a',
  openid: 'l48-reward-openid-a',
  nickname: 'Reward Leader A',
  avatar_url: null,
  role: 'leader',
  status: 'active',
};

const leaderB = {
  ...leaderA,
  id: 'l48-reward-leader-b',
  openid: 'l48-reward-openid-b',
  nickname: 'Reward Leader B',
};

const customer = {
  ...leaderA,
  id: 'l48-reward-customer',
  openid: 'l48-reward-customer-openid',
  role: 'customer',
};

const commissionA = {
  id: 'l48-reward-commission-a',
  leader_user_id: leaderA.id,
  order_id: 'l48-reward-order-a',
  group_buy_id: 'l48-reward-group-a',
  final_amount_cents: 2500,
  status: 'available',
  withdrawal_id: null,
};

const conversion = {
  id: 'l48-reward-conversion-a',
  leader_user_id: leaderA.id,
  commission_id: commissionA.id,
  client_request_id: 'l48-reward-request-a',
  amount_cents: 2500,
  conversion_type: 'credit',
  status: 'success',
  tax_status: 'pending_review',
  tax_record_id: 'l48-tax-record-internal',
  created_at: new Date('2026-07-19T00:00:00.000Z'),
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

function buildSuccessTx() {
  const rewardLedgerFindMany = vi
    .fn()
    .mockResolvedValue([{ direction: 'in', amount_cents: 5000 }]);
  return {
    rewardConversion: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(conversion),
    },
    commission: {
      findFirst: vi.fn().mockResolvedValue(commissionA),
      update: vi.fn().mockResolvedValue({ ...commissionA, status: 'converted' }),
    },
    taxRecord: {
      create: vi.fn().mockResolvedValue({
        id: 'l48-tax-record-internal',
        leader_user_id: leaderA.id,
        tax_remark: 'internal-tax-secret',
        reviewed_by_admin_id: 'admin-internal-id',
      }),
    },
    rewardLedger: {
      findMany: rewardLedgerFindMany,
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'l48-reward-ledger-internal',
        payload: { internal: true },
      }),
    },
    consumerCreditLedger: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'l48-credit-ledger-internal',
        balance_after_cents: 2500,
        payload: { internal: true },
      }),
    },
    businessEventLog: {
      create: vi.fn().mockResolvedValue({ id: 'l48-event-internal' }),
    },
  } as any;
}

function mockTransactionWith(tx: any): void {
  vi.spyOn(prisma, '$transaction').mockImplementation(
    (async (callback: (client: any) => Promise<unknown>) => callback(tx)) as any,
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

describe('L48 leader reward conversion security', () => {
  it('rejects body-only leader identity with 401', async () => {
    mockIdentityUsers();
    const transaction = vi.spyOn(prisma, '$transaction');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/rewards/convert-credit',
      payload: {
        leader_user_id: leaderA.id,
        commission_ids: [commissionA.id],
        amount_cents: 2500,
        client_request_id: conversion.client_request_id,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a customer before opening the transaction', async () => {
    mockIdentityUsers();
    const transaction = vi.spyOn(prisma, '$transaction');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/rewards/convert-credit',
      headers: { 'x-user-id': customer.id },
      payload: {
        commission_ids: [commissionA.id],
        amount_cents: 2500,
        client_request_id: conversion.client_request_id,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '仅开团人可访问',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('uses the header leader for all reads and writes and returns only the public DTO', async () => {
    mockIdentityUsers();
    const tx = buildSuccessTx();
    mockTransactionWith(tx);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/rewards/convert-credit',
      headers: { 'x-user-id': leaderA.id },
      payload: {
        leader_user_id: leaderB.id,
        commission_ids: [commissionA.id],
        amount_cents: 2500,
        client_request_id: conversion.client_request_id,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(tx.commission.findFirst).toHaveBeenCalledWith({
      where: { id: commissionA.id, leader_user_id: leaderA.id },
    });
    expect(tx.taxRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leader_user_id: leaderA.id }),
    });
    expect(tx.rewardConversion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ leader_user_id: leaderA.id }),
    });
    expect(tx.consumerCreditLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: leaderA.id }),
    });

    expect(response.json()).toMatchObject({
      success: true,
      data: {
        conversion_id: conversion.id,
        commission_id: commissionA.id,
        amount_cents: 2500,
        status: 'success',
        tax_status: 'pending_review',
        consumer_credit_balance_after_cents: 2500,
        created_at: '2026-07-19T00:00:00.000Z',
        idempotent: false,
      },
    });

    const keys = collectKeys(response.json());
    for (const key of [
      'leader_user_id',
      'tax_record',
      'consumer_credit_ledgers',
      'reward_ledgers',
      'payload',
      'tax_remark',
      'reviewed_by_admin_id',
    ]) {
      expect(keys).not.toContain(key);
    }
    expect(response.body).not.toContain('internal-tax-secret');
    expect(response.body).not.toContain('admin-internal-id');
    expect(response.body).not.toContain('l48-reward-ledger-internal');
  });

  it('does not allow leader A to convert leader B commission', async () => {
    mockIdentityUsers();
    const tx = buildSuccessTx();
    tx.commission.findFirst.mockResolvedValue(null);
    mockTransactionWith(tx);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/rewards/convert-credit',
      headers: { 'x-user-id': leaderA.id },
      payload: {
        commission_ids: ['leader-b-commission'],
        amount_cents: 2500,
        client_request_id: 'l48-cross-leader-request',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      message: '开团服务奖励不存在',
    });
    expect(tx.commission.findFirst).toHaveBeenCalledWith({
      where: { id: 'leader-b-commission', leader_user_id: leaderA.id },
    });
  });

  it('returns a fixed 500 for an unknown transaction error', async () => {
    mockIdentityUsers();
    vi.spyOn(prisma, '$transaction').mockRejectedValue(
      new Error('unique-reward-transaction-secret'),
    );
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/leaders/me/rewards/convert-credit',
      headers: { 'x-user-id': leaderA.id },
      payload: {
        commission_ids: [commissionA.id],
        amount_cents: 2500,
        client_request_id: conversion.client_request_id,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '开团服务奖励转换消费额度失败',
    });
    expect(response.body).not.toContain('unique-reward-transaction-secret');
  });
});
