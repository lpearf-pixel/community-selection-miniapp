import { randomBytes, sign, verify } from 'node:crypto';

type PemKey = string | Buffer;

export function buildWechatRequestMessage(input: {
  method: string;
  url: string;
  timestamp: number;
  nonce: string;
  body: string;
}): string {
  const url = new URL(input.url);
  return [
    input.method.toUpperCase(),
    `${url.pathname}${url.search}`,
    String(input.timestamp),
    input.nonce,
    input.body,
    '',
  ].join('\n');
}

export function createWechatAuthorization(input: {
  method: string;
  url: string;
  body?: string;
  merchantId: string;
  serialNo: string;
  privateKey: PemKey;
  timestamp?: number;
  nonce?: string;
}): string {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1_000);
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const message = buildWechatRequestMessage({
    method: input.method,
    url: input.url,
    timestamp,
    nonce,
    body: input.body ?? '',
  });
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(message),
    input.privateKey,
  ).toString('base64');
  return (
    'WECHATPAY2-SHA256-RSA2048 ' +
    `mchid="${input.merchantId}",` +
    `nonce_str="${nonce}",` +
    `timestamp="${timestamp}",` +
    `serial_no="${input.serialNo}",` +
    `signature="${signature}"`
  );
}

export function createJsapiPaySignature(input: {
  appId: string;
  prepayId: string;
  privateKey: PemKey;
  timestamp?: number;
  nonce?: string;
}) {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1_000);
  const nonce = input.nonce ?? randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${input.prepayId}`;
  const message = [
    input.appId,
    String(timestamp),
    nonce,
    packageValue,
    '',
  ].join('\n');
  return {
    timeStamp: String(timestamp),
    nonceStr: nonce,
    package: packageValue,
    signType: 'RSA' as const,
    paySign: sign(
      'RSA-SHA256',
      Buffer.from(message),
      input.privateKey,
    ).toString('base64'),
  };
}

type ClientOptions = {
  appId: string;
  merchantId: string;
  serialNo: string;
  privateKey: PemKey;
  paymentNotifyUrl: string;
  refundNotifyUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  nonce?: () => string;
  timeoutMs?: number;
  platformSerialNo?: string;
  platformPublicKey?: PemKey;
};

type ProviderErrorPayload = {
  code?: unknown;
};

function safeProviderCode(payload: ProviderErrorPayload): string {
  return typeof payload.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(payload.code)
    ? payload.code
    : 'UNKNOWN';
}

export function createWechatPayV3Client(options: ClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const makeNonce =
    options.nonce ?? (() => randomBytes(16).toString('hex'));
  const timeoutMs = options.timeoutMs ?? 8_000;

  async function requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    const url = `https://api.mch.weixin.qq.com${path}`;
    const body = payload ? JSON.stringify(payload) : '';
    const timestamp = Math.floor(now().getTime() / 1_000);
    const nonce = makeNonce();
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'community-selection-miniapp/1.0',
        Authorization: createWechatAuthorization({
          method,
          url,
          body,
          merchantId: options.merchantId,
          serialNo: options.serialNo,
          privateKey: options.privateKey,
          timestamp,
          nonce,
        }),
      },
      body: body || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const responseBody = await response.text();
    if (options.platformPublicKey || options.platformSerialNo) {
      if (!options.platformPublicKey || !options.platformSerialNo) {
        throw new Error('WECHAT_PAY_RESPONSE_VERIFY_CONFIG_INVALID');
      }
      const responseTimestamp =
        response.headers.get('wechatpay-timestamp') ?? '';
      const responseNonce = response.headers.get('wechatpay-nonce') ?? '';
      const responseSignature =
        response.headers.get('wechatpay-signature') ?? '';
      const responseSerial =
        response.headers.get('wechatpay-serial') ?? '';
      if (
        responseSerial !== options.platformSerialNo ||
        !/^\d{10}$/.test(responseTimestamp) ||
        !responseNonce ||
        !responseSignature ||
        Math.abs(
          Math.floor(now().getTime() / 1_000) - Number(responseTimestamp),
        ) > 300 ||
        !verify(
          'RSA-SHA256',
          Buffer.from(
            `${responseTimestamp}\n${responseNonce}\n${responseBody}\n`,
          ),
          options.platformPublicKey,
          Buffer.from(responseSignature, 'base64'),
        )
      ) {
        throw new Error('WECHAT_PAY_RESPONSE_SIGNATURE_INVALID');
      }
    }
    if (response.status === 204) return undefined as T;
    const data = (
      responseBody ? JSON.parse(responseBody) : {}
    ) as
      | T
      | ProviderErrorPayload;
    if (!response.ok) {
      throw new Error(
        `WECHAT_PAY_HTTP_${response.status}_${safeProviderCode(data as ProviderErrorPayload)}`,
      );
    }
    return data as T;
  }

  return {
    async createJsapiTransaction(input: {
      description: string;
      outTradeNo: string;
      amountCents: number;
      openid: string;
      expiresAt: Date;
      attach?: string;
      clientIp?: string;
    }) {
      const result = await requestJson<{ prepay_id?: unknown }>(
        'POST',
        '/v3/pay/transactions/jsapi',
        {
          appid: options.appId,
          mchid: options.merchantId,
          description: input.description,
          out_trade_no: input.outTradeNo,
          time_expire: input.expiresAt.toISOString(),
          notify_url: options.paymentNotifyUrl,
          amount: { total: input.amountCents, currency: 'CNY' },
          payer: { openid: input.openid },
          ...(input.attach ? { attach: input.attach } : {}),
          ...(input.clientIp
            ? { scene_info: { payer_client_ip: input.clientIp } }
            : {}),
        },
      );
      if (typeof result.prepay_id !== 'string' || !result.prepay_id) {
        throw new Error('WECHAT_PAY_INVALID_PREPAY_RESPONSE');
      }
      return { prepayId: result.prepay_id };
    },

    queryTransaction(outTradeNo: string) {
      return requestJson<Record<string, unknown>>(
        'GET',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
          outTradeNo,
        )}?mchid=${encodeURIComponent(options.merchantId)}`,
      );
    },

    closeTransaction(outTradeNo: string) {
      return requestJson<void>(
        'POST',
        `/v3/pay/transactions/out-trade-no/${encodeURIComponent(
          outTradeNo,
        )}/close`,
        { mchid: options.merchantId },
      );
    },

    applyRefund(input: {
      outTradeNo: string;
      outRefundNo: string;
      refundAmountCents: number;
      totalAmountCents: number;
      reason: string;
    }) {
      return requestJson<Record<string, unknown>>(
        'POST',
        '/v3/refund/domestic/refunds',
        {
          out_trade_no: input.outTradeNo,
          out_refund_no: input.outRefundNo,
          reason: input.reason,
          notify_url: options.refundNotifyUrl,
          amount: {
            refund: input.refundAmountCents,
            total: input.totalAmountCents,
            currency: 'CNY',
          },
        },
      );
    },

    queryRefund(outRefundNo: string) {
      return requestJson<Record<string, unknown>>(
        'GET',
        `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`,
      );
    },
  };
}
