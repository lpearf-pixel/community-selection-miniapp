import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db.js';
import { registerMembershipRoutes } from './membership.js';

const apps: ReturnType<typeof Fastify>[] = [];
const user = {
  id: 'user-1', openid: 'openid-1', role: 'customer' as const, status: 'active',
  nickname: '会员用户', avatar_url: null, unionid: null, phone: null,
  created_at: new Date('2026-07-31T00:00:00.000Z'),
  updated_at: new Date('2026-07-31T00:00:00.000Z'),
};

function appWith(options: Parameters<typeof registerMembershipRoutes>[1]) {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerMembershipRoutes(app, options);
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('membership routes', () => {
  it('returns only the authenticated user membership status', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const getStatus = vi.fn().mockResolvedValue({ active: true, period_id: 'period-1' });
    const app = appWith({ enabled: true, getStatus, activateLegacy: vi.fn(), claimGift: vi.fn(), releaseGift: vi.fn() });
    const response = await app.inject({ method: 'GET', url: '/api/me/membership?user_id=user-2', headers: { 'x-user-id': 'user-1' } });
    expect(response.statusCode).toBe(200);
    expect(getStatus).toHaveBeenCalledWith('user-1');
    expect(response.json()).toMatchObject({ success: true, data: { active: true, period_id: 'period-1' } });
  });

  it('activates legacy membership with server-owned identity and exact fields', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const activateLegacy = vi.fn().mockResolvedValue({ periodId: 'period-1', idempotent: false });
    const app = appWith({ enabled: true, getStatus: vi.fn(), activateLegacy, claimGift: vi.fn(), releaseGift: vi.fn() });
    const response = await app.inject({
      method: 'POST', url: '/api/me/membership/legacy-activate', headers: { 'x-user-id': 'user-1' },
      payload: { eligibility_id: 'eligibility-1', idempotency_key: 'legacy-activation-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(activateLegacy).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', eligibilityId: 'eligibility-1', idempotencyKey: 'legacy-activation-1',
    }));
  });

  it('rejects identity fields and disabled membership before mutation', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const activateLegacy = vi.fn();
    const app = appWith({ enabled: false, getStatus: vi.fn(), activateLegacy, claimGift: vi.fn(), releaseGift: vi.fn() });
    const response = await app.inject({
      method: 'POST', url: '/api/me/membership/legacy-activate', headers: { 'x-user-id': 'user-1' },
      payload: { eligibility_id: 'eligibility-1', idempotency_key: 'key-1', user_id: 'user-2' },
    });
    expect(response.statusCode).toBe(400);
    expect(activateLegacy).not.toHaveBeenCalled();
  });

  it('claims and releases gifts with fixed quantity one', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const claimGift = vi.fn().mockResolvedValue({ claimId: 'claim-1', status: 'reserved' });
    const releaseGift = vi.fn().mockResolvedValue({ claimId: 'claim-1', status: 'released' });
    const app = appWith({ enabled: true, getStatus: vi.fn(), activateLegacy: vi.fn(), claimGift, releaseGift });
    const claimed = await app.inject({
      method: 'POST', url: '/api/me/member-gifts/claim', headers: { 'x-user-id': 'user-1' },
      payload: { campaign_id: 'campaign-1', order_id: 'order-1', idempotency_key: 'claim-key-1' },
    });
    const released = await app.inject({
      method: 'POST', url: '/api/me/member-gifts/claim-1/release', headers: { 'x-user-id': 'user-1' },
      payload: { idempotency_key: 'release-key-1' },
    });
    expect(claimed.statusCode).toBe(200);
    expect(released.statusCode).toBe(200);
    expect(claimGift).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', orderId: 'order-1', quantity: 1 }));
    expect(releaseGift).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', claimId: 'claim-1' }));
  });

  it('requires a server-owned paid order reference for a gift claim', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const claimGift = vi.fn();
    const app = appWith({ enabled: true, getStatus: vi.fn(), activateLegacy: vi.fn(), claimGift, releaseGift: vi.fn() });
    const missing = await app.inject({
      method: 'POST', url: '/api/me/member-gifts/claim', headers: { 'x-user-id': 'user-1' },
      payload: { campaign_id: 'campaign-1', idempotency_key: 'claim-key-2' },
    });
    const injectedIdentity = await app.inject({
      method: 'POST', url: '/api/me/member-gifts/claim', headers: { 'x-user-id': 'user-1' },
      payload: { campaign_id: 'campaign-1', order_id: 'order-1', idempotency_key: 'claim-key-3', user_id: 'user-2' },
    });
    expect([missing.statusCode, injectedIdentity.statusCode]).toEqual([400, 400]);
    expect(claimGift).not.toHaveBeenCalled();
  });

  it('creates and mock-pays an independent 88 yuan membership order', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const createPaidOrder = vi.fn().mockResolvedValue({
      membership_order_id: 'membership-order-1', amount_cents: 8_800, status: 'pending_payment',
    });
    const payPaidOrderMock = vi.fn().mockResolvedValue({
      membership_order_id: 'membership-order-1', status: 'paid', membership_period_id: 'period-1',
    });
    const app = appWith({
      enabled: true, getStatus: vi.fn(), activateLegacy: vi.fn(), claimGift: vi.fn(),
      releaseGift: vi.fn(), createPaidOrder, payPaidOrderMock,
    });
    const created = await app.inject({
      method: 'POST', url: '/api/me/membership/orders', headers: { 'x-user-id': 'user-1' },
      payload: { idempotency_key: 'membership-order-key-1' },
    });
    const paid = await app.inject({
      method: 'POST', url: '/api/me/membership/orders/membership-order-1/mock-pay',
      headers: { 'x-user-id': 'user-1' }, payload: {},
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ data: { amount_cents: 8_800, status: 'pending_payment' } });
    expect(createPaidOrder).toHaveBeenCalledWith({
      userId: 'user-1', idempotencyKey: 'membership-order-key-1',
    });
    expect(paid.statusCode).toBe(200);
    expect(payPaidOrderMock).toHaveBeenCalledWith({
      userId: 'user-1', membershipOrderId: 'membership-order-1',
    });
  });

  it('initializes WeChat payment without accepting client-owned price or identity', async () => {
    vi.stubEnv('WECHAT_PAY_MODE', 'wechat');
    vi.stubEnv('MOCK_WECHAT_PAY', 'false');
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(user);
    const initializePaidOrderWechat = vi.fn().mockResolvedValue({
      order_id: 'membership-order-1', amount_cents: 8_800,
      wx_request_payment: { package: 'prepay_id=membership-a' },
    });
    const app = appWith({
      enabled: true, getStatus: vi.fn(), activateLegacy: vi.fn(), claimGift: vi.fn(),
      releaseGift: vi.fn(), initializePaidOrderWechat,
    });
    const response = await app.inject({
      method: 'POST', url: '/api/me/membership/orders/membership-order-1/wechat-jsapi',
      headers: { 'x-user-id': 'user-1' }, payload: {},
    });
    const rejected = await app.inject({
      method: 'POST', url: '/api/me/membership/orders/membership-order-1/wechat-jsapi',
      headers: { 'x-user-id': 'user-1' }, payload: { amount_cents: 1, user_id: 'user-2' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { membership_order_id: 'membership-order-1', amount_cents: 8_800 },
    });
    expect(initializePaidOrderWechat).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', membershipOrderId: 'membership-order-1',
    }));
    expect(rejected.statusCode).toBe(400);
  });
});
