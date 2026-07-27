import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('consumer order request errors', () => {
  it('returns a safe 400 when a store order omits the pickup store', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 'order-request-user',
      openid: 'order-request-openid',
      role: 'customer',
      status: 'active',
      nickname: 'Order Request User',
      avatar_url: null,
    } as never);
    const transaction = vi.spyOn(prisma, '$transaction');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/normal',
      headers: { 'x-user-id': 'order-request-user' },
      payload: {
        product_id: 'product-a',
        client_request_id: 'missing-pickup',
        quantity: 1,
        receiver_name: '缺少自提点用户',
        receiver_phone: '13612340000',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: '自提点必填校验：请选择自提点',
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
