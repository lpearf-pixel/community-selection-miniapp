import { describe, expect, it, vi } from 'vitest';
import { createWechatAccessTokenClient } from './wechat-access-token-client.js';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('WeChat access token client', () => {
  it('reuses a token until five minutes before expiry and then refreshes it', async () => {
    let now = new Date('2026-07-29T12:00:00.000Z');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'token-one', expires_in: 7200 }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'token-two', expires_in: 7200 }),
      );
    const client = createWechatAccessTokenClient({
      appId: 'wx-app',
      appSecret: 'private-app-secret',
      fetchImpl,
      now: () => now,
    });

    await expect(client.getAccessToken()).resolves.toBe('token-one');
    now = new Date('2026-07-29T13:54:59.000Z');
    await expect(client.getAccessToken()).resolves.toBe('token-one');
    now = new Date('2026-07-29T13:55:00.000Z');
    await expect(client.getAccessToken()).resolves.toBe('token-two');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('normalizes provider errors without leaking the secret', async () => {
    const client = createWechatAccessTokenClient({
      appId: 'wx-app',
      appSecret: 'private-app-secret',
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ errcode: 40013 })),
    });

    const error = await client.getAccessToken().catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('WECHAT_ACCESS_TOKEN_40013');
    expect(error.message).not.toContain('private-app-secret');
  });

  it('normalizes network and HTTP failures', async () => {
    const networkClient = createWechatAccessTokenClient({
      appId: 'wx-app',
      appSecret: 'private-app-secret',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('socket')),
    });
    await expect(networkClient.getAccessToken()).rejects.toThrow(
      'WECHAT_ACCESS_TOKEN_NETWORK',
    );

    const httpClient = createWechatAccessTokenClient({
      appId: 'wx-app',
      appSecret: 'private-app-secret',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
        status: 503,
      })),
    });
    await expect(httpClient.getAccessToken()).rejects.toThrow(
      'WECHAT_ACCESS_TOKEN_HTTP_503',
    );
  });
});
