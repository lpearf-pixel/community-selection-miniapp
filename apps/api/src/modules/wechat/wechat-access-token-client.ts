export type WechatAccessTokenClient = {
  getAccessToken(): Promise<string>;
};

export function createWechatAccessTokenClient(options: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}): WechatAccessTokenClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 5_000;
  let cached: { token: string; refreshAt: number } | null = null;

  return {
    async getAccessToken() {
      const nowMs = now().getTime();
      if (cached && nowMs < cached.refreshAt) return cached.token;

      const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
      url.searchParams.set('grant_type', 'client_credential');
      url.searchParams.set('appid', options.appId);
      url.searchParams.set('secret', options.appSecret);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 'WECHAT_ACCESS_TOKEN_TIMEOUT'
            : 'WECHAT_ACCESS_TOKEN_NETWORK',
        );
      }
      if (!response.ok) {
        throw new Error(`WECHAT_ACCESS_TOKEN_HTTP_${response.status}`);
      }

      let payload: {
        access_token?: unknown;
        expires_in?: unknown;
        errcode?: unknown;
      };
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        throw new Error('WECHAT_ACCESS_TOKEN_INVALID_RESPONSE');
      }
      if (
        typeof payload.errcode === 'number' &&
        Number.isInteger(payload.errcode) &&
        payload.errcode !== 0
      ) {
        throw new Error(`WECHAT_ACCESS_TOKEN_${payload.errcode}`);
      }
      if (
        typeof payload.access_token !== 'string' ||
        !payload.access_token ||
        !Number.isSafeInteger(payload.expires_in) ||
        Number(payload.expires_in) <= 300
      ) {
        throw new Error('WECHAT_ACCESS_TOKEN_INVALID_RESPONSE');
      }

      cached = {
        token: payload.access_token,
        refreshAt:
          nowMs + (Number(payload.expires_in) - 300) * 1_000,
      };
      return cached.token;
    },
  };
}
