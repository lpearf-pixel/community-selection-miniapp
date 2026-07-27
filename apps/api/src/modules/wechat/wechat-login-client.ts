export type WechatLoginIdentity = {
  openid: string;
  unionid: string | null;
};

export type WechatLoginClient = {
  exchangeCode(code: string): Promise<WechatLoginIdentity>;
};

export function createWechatLoginClient(options: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): WechatLoginClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return {
    async exchangeCode(code: string): Promise<WechatLoginIdentity> {
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
      url.searchParams.set('appid', options.appId);
      url.searchParams.set('secret', options.appSecret);
      url.searchParams.set('js_code', code);
      url.searchParams.set('grant_type', 'authorization_code');

      const response = await fetchImpl(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`WECHAT_LOGIN_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as {
        errcode?: unknown;
        openid?: unknown;
        unionid?: unknown;
      };
      if (
        typeof payload.errcode === 'number' &&
        Number.isInteger(payload.errcode) &&
        payload.errcode !== 0
      ) {
        throw new Error(`WECHAT_LOGIN_${payload.errcode}`);
      }
      if (typeof payload.openid !== 'string' || !payload.openid.trim()) {
        throw new Error('WECHAT_LOGIN_INVALID_RESPONSE');
      }
      return {
        openid: payload.openid.trim(),
        unionid:
          typeof payload.unionid === 'string' && payload.unionid.trim()
            ? payload.unionid.trim()
            : null,
      };
    },
  };
}
