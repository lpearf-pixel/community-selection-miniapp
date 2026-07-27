import { describe, expect, it, vi } from 'vitest';
import { createWechatLoginClient } from './wechat-login-client.js';

describe('WeChat code2session client', () => {
  it('encodes credentials and returns only stable identity fields', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          openid: 'openid-a',
          unionid: 'union-a',
          session_key: 'must-not-leave-client',
        }),
        { status: 200 },
      ),
    );
    const client = createWechatLoginClient({
      appId: 'wx app',
      appSecret: 'secret/value',
      fetchImpl,
    });

    await expect(client.exchangeCode('login code')).resolves.toEqual({
      openid: 'openid-a',
      unionid: 'union-a',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestedUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(requestedUrl).toContain('appid=wx+app');
    expect(requestedUrl).toContain('secret=secret%2Fvalue');
    expect(requestedUrl).toContain('js_code=login+code');
  });

  it('rejects provider errors and malformed identity responses', async () => {
    const providerError = createWechatLoginClient({
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: async () =>
        new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' })),
    });
    await expect(providerError.exchangeCode('bad')).rejects.toThrow(
      /WECHAT_LOGIN_40029/,
    );

    const missingOpenid = createWechatLoginClient({
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: async () => new Response(JSON.stringify({ session_key: 'x' })),
    });
    await expect(missingOpenid.exchangeCode('bad')).rejects.toThrow(
      /WECHAT_LOGIN_INVALID_RESPONSE/,
    );
  });
});
