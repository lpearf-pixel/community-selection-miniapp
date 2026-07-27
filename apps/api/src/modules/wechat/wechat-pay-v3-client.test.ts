import {
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWechatRequestMessage,
  createJsapiPaySignature,
  createWechatAuthorization,
  createWechatPayV3Client,
} from './wechat-pay-v3-client.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keys.privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });

describe('WeChat Pay v3 signing', () => {
  it('signs the exact method, path/query, timestamp, nonce, and body', () => {
    const body = '{"amount":{"total":1}}';
    const message = buildWechatRequestMessage({
      method: 'POST',
      url: 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi?x=1',
      timestamp: 1_700_000_000,
      nonce: 'nonce-a',
      body,
    });
    expect(message).toBe(
      'POST\n/v3/pay/transactions/jsapi?x=1\n1700000000\nnonce-a\n{"amount":{"total":1}}\n',
    );

    const authorization = createWechatAuthorization({
      method: 'POST',
      url: 'https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi?x=1',
      body,
      merchantId: 'merchant-a',
      serialNo: 'serial-a',
      privateKey,
      timestamp: 1_700_000_000,
      nonce: 'nonce-a',
    });
    const signature = /signature="([^"]+)"/.exec(authorization)?.[1];
    expect(authorization).toContain('mchid="merchant-a"');
    expect(signature).toBeTruthy();
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(message),
        publicKey,
        Buffer.from(signature!, 'base64'),
      ),
    ).toBe(true);
  });

  it('creates a verifiable miniapp requestPayment signature', () => {
    const result = createJsapiPaySignature({
      appId: 'wx-app',
      prepayId: 'prepay-a',
      privateKey,
      timestamp: 1_700_000_001,
      nonce: 'nonce-b',
    });
    const message = 'wx-app\n1700000001\nnonce-b\nprepay_id=prepay-a\n';
    expect(result).toMatchObject({
      timeStamp: '1700000001',
      nonceStr: 'nonce-b',
      package: 'prepay_id=prepay-a',
      signType: 'RSA',
    });
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(message),
        publicKey,
        Buffer.from(result.paySign, 'base64'),
      ),
    ).toBe(true);
  });

  it('sends signed JSON and maps deterministic provider errors', async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ prepay_id: 'prepay-a' }), {
          status: 200,
        }),
    );
    const client = createWechatPayV3Client({
      appId: 'wx-app',
      merchantId: 'merchant-a',
      serialNo: 'serial-a',
      privateKey,
      paymentNotifyUrl: 'https://api.example.test/pay-notify',
      refundNotifyUrl: 'https://api.example.test/refund-notify',
      fetchImpl,
      now: () => new Date(1_700_000_000_000),
      nonce: () => 'nonce-c',
    });

    await expect(
      client.createJsapiTransaction({
        description: '测试订单',
        outTradeNo: 'PAYORDER1',
        amountCents: 1,
        openid: 'openid-a',
        expiresAt: new Date('2026-07-27T01:00:00.000Z'),
      }),
    ).resolves.toEqual({ prepayId: 'prepay-a' });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(String((init?.headers as Record<string, string>).Authorization)).toContain(
      'WECHATPAY2-SHA256-RSA2048',
    );
  });

  it('rejects a provider response whose platform signature is invalid', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('{"prepay_id":"prepay-a"}', {
        status: 200,
        headers: {
          'wechatpay-timestamp': '1700000000',
          'wechatpay-nonce': 'response-nonce',
          'wechatpay-serial': 'platform-serial',
          'wechatpay-signature': Buffer.from('invalid').toString('base64'),
        },
      }),
    );
    const client = createWechatPayV3Client({
      appId: 'wx-app',
      merchantId: 'merchant-a',
      serialNo: 'merchant-serial',
      privateKey,
      platformSerialNo: 'platform-serial',
      platformPublicKey: publicKey,
      paymentNotifyUrl: 'https://api.example.test/pay-notify',
      refundNotifyUrl: 'https://api.example.test/refund-notify',
      fetchImpl,
      now: () => new Date(1_700_000_000_000),
    });

    await expect(
      client.createJsapiTransaction({
        description: '测试订单',
        outTradeNo: 'PAYORDER1',
        amountCents: 1,
        openid: 'openid-a',
        expiresAt: new Date('2026-07-27T01:00:00.000Z'),
      }),
    ).rejects.toThrow('WECHAT_PAY_RESPONSE_SIGNATURE_INVALID');
  });
});
