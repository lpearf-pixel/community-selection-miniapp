import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db.js';

const openedApps: ReturnType<typeof buildApp>[] = [];

const activeUserA = {
  id: 'l48-order-user-a',
  openid: 'l48-order-openid-a',
  nickname: 'Order User A',
  avatar_url: null,
  role: 'customer',
  status: 'active',
};

const activeUserB = {
  ...activeUserA,
  id: 'l48-order-user-b',
  openid: 'l48-order-openid-b',
  nickname: 'Order User B',
};

const deliveryOrder = {
  id: 'l48-order-a',
  order_no: 'L48-ORDER-000001',
  user_id: activeUserA.id,
  group_buy_id: null,
  group_buy: null,
  product_id: 'l48-product-a',
  product: {
    id: 'l48-product-a',
    name: '安全测试商品',
    cover_image: null,
    price_cents: 1990,
    sale_unit: '份',
    sale_spec_name: null,
  },
  quantity: 1,
  total_amount_cents: 1990,
  product_amount_cents: 1790,
  delivery_fee_cents: 200,
  pay_amount_cents: 1990,
  refund_amount_cents: 0,
  product_refund_amount_cents: 0,
  delivery_refund_amount_cents: 0,
  pay_status: 'paid',
  order_status: 'paid',
  refund_status: 'none',
  pickup_type: 'delivery',
  delivery_time_window_code: 'pm',
  delivery_time_window_text: '14:00-18:00',
  receiver_name: '张三丰',
  receiver_phone: '13912345678',
  receiver_address: '南京市玄武区安全测试路88号',
  pickup_store_id: 'l48-store-a',
  pickup_store: {
    id: 'l48-store-a',
    name: '社区门店',
    address: '南京市玄武区门店路1号',
    phone: '02512345678',
  },
  community: { id: 'l48-community-a', name: '安全社区' },
  after_sale_cases: [],
  created_at: new Date('2026-07-19T00:00:00.000Z'),
  paid_at: new Date('2026-07-19T00:05:00.000Z'),
  completed_at: null,
};

function userResult(value: unknown): ReturnType<typeof prisma.user.findUnique> {
  return Promise.resolve(value) as unknown as ReturnType<typeof prisma.user.findUnique>;
}

function mockUserLookup(): void {
  vi.spyOn(prisma.user, 'findUnique').mockImplementation((args: any) => {
    const where = args?.where ?? {};
    if (where.id === activeUserA.id || where.openid === activeUserA.openid) {
      return userResult(activeUserA);
    }
    if (where.id === activeUserB.id || where.openid === activeUserB.openid) {
      return userResult(activeUserB);
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

function mockOrderList(order = deliveryOrder): void {
  vi.spyOn(prisma.order, 'count').mockResolvedValue(1);
  vi.spyOn(prisma.order, 'findMany').mockResolvedValue([order] as any);
}

function mockOwnedOrder(order: typeof deliveryOrder | null): void {
  vi.spyOn(prisma.order, 'findFirst').mockResolvedValue(order as any);
  vi.spyOn(prisma.orderTimelineLog, 'findMany').mockResolvedValue([] as any);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(openedApps.splice(0).map((app) => app.close()));
});

describe('L48 user order route security', () => {
  it('rejects query-only identity with 401 before reading orders', async () => {
    mockUserLookup();
    const orderCount = vi.spyOn(prisma.order, 'count');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/me/orders?user_id=${activeUserB.id}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      message: '缺少用户身份',
    });
    expect(orderCount).not.toHaveBeenCalled();
  });

  it('uses the header identity when query identity conflicts', async () => {
    mockUserLookup();
    mockOrderList();
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: `/api/me/orders?user_id=${activeUserB.id}`,
      headers: { 'x-user-id': activeUserA.id },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: { user_id: activeUserA.id },
    });
  });

  it('rejects inactive users before order lookup', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockReturnValue(
      userResult({ ...activeUserA, status: 'inactive' }),
    );
    const orderCount = vi.spyOn(prisma.order, 'count');
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me/orders',
      headers: { 'x-user-id': activeUserA.id },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      message: '用户状态不可用',
    });
    expect(orderCount).not.toHaveBeenCalled();
  });

  it('returns a fixed 500 when Prisma fails', async () => {
    mockUserLookup();
    vi.spyOn(prisma.order, 'count').mockRejectedValue(
      new Error('unique-order-db-secret'),
    );
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([] as any);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me/orders',
      headers: { 'x-user-id': activeUserA.id },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      message: '用户订单操作失败',
    });
    expect(response.body).not.toContain('unique-order-db-secret');
  });

  it('preserves the public 404 for a missing owned order', async () => {
    mockUserLookup();
    mockOwnedOrder(null);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/api/me/orders/missing-order',
      headers: { 'x-user-id': activeUserA.id },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      success: false,
      message: '订单不存在',
    });
  });

  it('preserves known after-sale validation errors as public 400 responses', async () => {
    mockUserLookup();
    mockOwnedOrder(deliveryOrder);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: `/api/me/orders/${deliveryOrder.id}/after-sales`,
      headers: { 'x-user-id': activeUserA.id },
      payload: { type: 'invalid-type', reason: '测试原因' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      message: '售后类型不合法',
    });
  });

  it('omits raw receiver keys from list, detail, and pickup-code responses', async () => {
    mockUserLookup();
    mockOrderList();
    mockOwnedOrder(deliveryOrder);
    const app = buildApp();
    openedApps.push(app);
    await app.ready();

    const headers = { 'x-user-id': activeUserA.id };
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/me/orders',
      headers,
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/me/orders/${deliveryOrder.id}`,
      headers,
    });
    const pickupResponse = await app.inject({
      method: 'GET',
      url: `/api/me/orders/${deliveryOrder.id}/pickup-code`,
      headers,
    });

    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect(pickupResponse.statusCode).toBe(200);

    for (const response of [listResponse, detailResponse, pickupResponse]) {
      const keys = collectKeys(response.json());
      expect(keys).not.toContain('receiver_name');
      expect(keys).not.toContain('receiver_phone');
      expect(keys).not.toContain('receiver_address');
      expect(response.body).not.toContain('张三丰');
      expect(response.body).not.toContain('13912345678');
      expect(response.body).not.toContain('南京市玄武区安全测试路88号');
    }

    expect(listResponse.json()).toMatchObject({
      data: {
        items: [
          {
            receiver_address_masked: '南京市***8号',
          },
        ],
      },
    });
    expect(detailResponse.json()).toMatchObject({
      data: {
        receiver: {
          receiver_name_masked: '张*',
          receiver_phone_masked: '139****5678',
          receiver_address_masked: '南京市***8号',
        },
      },
    });
    expect(pickupResponse.json()).toMatchObject({
      data: {
        receiver_name_masked: '张*',
        receiver_phone_masked: '139****5678',
      },
    });
  });
});
