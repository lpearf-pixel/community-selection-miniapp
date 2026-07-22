import { describe, expect, it, vi } from 'vitest';
import {
  DELIVERY_SEQUENCE,
  FixtureApi,
  FixtureApiError,
  STORE_SEQUENCE,
  assertGroupSucceeded,
  assertOrderState,
} from '../src/fixture-api.js';

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('FixtureApi', () => {
  it('unwraps success envelopes and preserves status and path on failure', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { success: true, data: { id: 'p1' } }))
      .mockResolvedValueOnce(response(409, { success: false, message: '状态冲突' }));
    const api = new FixtureApi('http://127.0.0.1:13080', fetchImpl);

    await expect(api.request('/api/products/p1')).resolves.toEqual({ id: 'p1' });
    await expect(api.request('/api/orders/o1/status')).rejects.toMatchObject({
      name: 'FixtureApiError',
      message: '状态冲突',
      status: 409,
      pathname: '/api/orders/o1/status',
    });
  });

  it('selects one visible group-enabled product and a matching community/store pair', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('/api/products')) return response(200, {
        success: true,
        data: { items: [
          { product_id: 'p1', name: '测试青菜', stock: 20, status: 'active', is_group_enabled: true },
        ] },
      });
      if (url.endsWith('/api/communities')) return response(200, {
        success: true,
        data: [
          { id: 'c1', name: '一号社区' },
          { id: 'c2', name: '二号社区' },
        ],
      });
      if (url.includes('community_id=c1')) return response(200, {
        success: true,
        data: { items: [] },
      });
      if (url.includes('community_id=c2')) return response(200, {
        success: true,
        data: { items: [{ id: 's2', community_id: 'c2', name: '二号自提点' }] },
      });
      throw new Error(`unexpected URL ${url}`);
    });
    const api = new FixtureApi('http://127.0.0.1:13080', fetchImpl);

    await expect(api.loadBusinessFixture()).resolves.toMatchObject({
      product: { product_id: 'p1', name: '测试青菜' },
      community: { community_id: 'c2' },
      pickupStore: { pickup_store_id: 's2', community_id: 'c2' },
    });
  });

  it('ignores only a missing user during cleanup discovery', async () => {
    const missing = new FixtureApi('http://127.0.0.1:13080', async () => response(404, {
      success: false,
      message: '用户不存在',
    }));
    await expect(missing.discoverUserOrders([], ['never-created'])).resolves.toEqual([]);

    const broken = new FixtureApi('http://127.0.0.1:13080', async () => response(500, {
      success: false,
      message: '数据库失败',
    }));
    await expect(broken.discoverUserOrders([], ['broken-user']))
      .rejects.toBeInstanceOf(FixtureApiError);
  });

  it('normalizes public order-list identifiers for cleanup discovery', async () => {
    const api = new FixtureApi('http://127.0.0.1:13080', async () => response(200, {
      success: true,
      data: { items: [
        { order_id: 'order-public-1' },
        { id: 'order-legacy-2' },
        { order_id: '' },
      ] },
    }));

    await expect(api.discoverUserOrders([], ['buyer-openid'])).resolves.toEqual([
      { id: 'order-public-1', openid: 'buyer-openid' },
      { id: 'order-legacy-2', openid: 'buyer-openid' },
    ]);
  });

  it('locks store and delivery fulfillment sequences', () => {
    expect(STORE_SEQUENCE).toEqual(['preparing', 'ready', 'picked', 'completed']);
    expect(DELIVERY_SEQUENCE).toEqual(['preparing', 'ready', 'delivered', 'completed']);
  });

  it('advances pickup through the real verification endpoint and re-reads user state', async () => {
    const calls: Array<{ url: string; method: string; headers: HeadersInit | undefined }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init = {}) => {
      calls.push({
        url: String(input),
        method: init.method || 'GET',
        headers: init.headers,
      });
      return response(200, {
        success: true,
        data: { id: 'o1', pay_status: 'paid', order_status: 'picked' },
      });
    });
    const api = new FixtureApi('http://127.0.0.1:13080', fetchImpl);

    await api.advanceOrder('o1', ['picked'], 'buyer-openid');

    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:13080/api/admin/orders/o1/pickup-verify',
      method: 'POST',
    });
    expect(calls[1]).toMatchObject({
      url: 'http://127.0.0.1:13080/api/me/orders/o1',
      method: 'GET',
    });
    expect(calls[1].headers).toMatchObject({ 'x-openid': 'buyer-openid' });
  });

  it('requests only the remaining refundable balance', async () => {
    let body = '';
    const api = new FixtureApi('http://127.0.0.1:13080', async (_input, init = {}) => {
      body = String(init.body);
      return response(200, { success: true, data: { id: 'refund-1' } });
    });

    await api.createFullMockRefund({
      id: 'o1',
      pay_amount_cents: 3300,
      refund_amount_cents: 800,
    }, 'run-1');

    expect(JSON.parse(body)).toMatchObject({
      order_id: 'o1',
      refund_amount_cents: 2500,
      client_refund_id: 'miniapp-business-run-1-o1',
    });
  });

  it('asserts order and group business states without retrying them', () => {
    expect(() => assertOrderState(
      { pay_status: 'paid', order_status: 'completed' },
      { pay_status: 'paid', order_status: 'completed' },
    )).not.toThrow();
    expect(() => assertOrderState(
      { order_status: 'paid' },
      { order_status: 'completed' },
    )).toThrow('expected order_status=completed');
    expect(() => assertGroupSucceeded({
      status: 'success',
      paid_quantity: 2,
      target_count: 2,
    })).not.toThrow();
  });
});
