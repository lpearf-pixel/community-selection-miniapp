import { describe, expect, it, vi } from 'vitest';
import { createWechatShippingClient } from './wechat-shipping-client.js';

describe('WeChat shipping upload client', () => {
  it('uploads the approved payload with a short-lived access token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), {
        status: 200,
      }),
    );
    const client = createWechatShippingClient({
      getAccessToken: async () => 'access-token',
      fetchImpl,
    });
    const payload = {
      order_key: {
        order_number_type: 1 as const,
        transaction_id: '420001',
      },
      delivery_mode: 1 as const,
      logistics_type: 2 as const,
      shipping_list: [{ item_desc: '有机蔬菜' }],
      upload_time: '2026-07-29T12:00:00.000Z',
      payer: { openid: 'openid-one' },
    };

    await expect(client.upload(payload)).resolves.toBeUndefined();
    const [url, request] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.weixin.qq.com/wxa/sec/order/upload_shipping_info?access_token=access-token',
    );
    expect(request).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  it('normalizes provider, HTTP and network failures', async () => {
    const provider = createWechatShippingClient({
      getAccessToken: async () => 'access-token',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ errcode: 40013 }), { status: 200 }),
      ),
    });
    await expect(provider.upload({} as never)).rejects.toThrow(
      'WECHAT_SHIPPING_40013',
    );

    const http = createWechatShippingClient({
      getAccessToken: async () => 'access-token',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('', { status: 502 }),
      ),
    });
    await expect(http.upload({} as never)).rejects.toThrow(
      'WECHAT_SHIPPING_HTTP_502',
    );

    const network = createWechatShippingClient({
      getAccessToken: async () => 'access-token',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('socket')),
    });
    await expect(network.upload({} as never)).rejects.toThrow(
      'WECHAT_SHIPPING_NETWORK',
    );
  });
});
