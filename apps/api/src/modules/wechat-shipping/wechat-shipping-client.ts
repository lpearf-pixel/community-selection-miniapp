import type { WechatShippingPayload } from './wechat-shipping-policy.js';

export type WechatShippingClient = {
  upload(payload: WechatShippingPayload): Promise<void>;
};

export function createWechatShippingClient(options: {
  getAccessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): WechatShippingClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  return {
    async upload(payload) {
      const accessToken = await options.getAccessToken();
      const url = new URL(
        'https://api.weixin.qq.com/wxa/sec/order/upload_shipping_info',
      );
      url.searchParams.set('access_token', accessToken);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 'WECHAT_SHIPPING_TIMEOUT'
            : 'WECHAT_SHIPPING_NETWORK',
        );
      }
      if (!response.ok) {
        throw new Error(`WECHAT_SHIPPING_HTTP_${response.status}`);
      }

      let result: { errcode?: unknown };
      try {
        result = (await response.json()) as typeof result;
      } catch {
        throw new Error('WECHAT_SHIPPING_INVALID_RESPONSE');
      }
      if (
        typeof result.errcode !== 'number' ||
        !Number.isInteger(result.errcode)
      ) {
        throw new Error('WECHAT_SHIPPING_INVALID_RESPONSE');
      }
      if (result.errcode !== 0) {
        throw new Error(`WECHAT_SHIPPING_${result.errcode}`);
      }
    },
  };
}
