import { describe, expect, it } from 'vitest';
import { loadWechatRuntimeConfig } from './wechat-config.js';

describe('WeChat runtime configuration', () => {
  it('allows explicit mock mode without production credentials', () => {
    expect(
      loadWechatRuntimeConfig({
        NODE_ENV: 'development',
        WECHAT_PAY_MODE: 'mock',
        MOCK_WECHAT_PAY: 'true',
      }),
    ).toMatchObject({ paymentMode: 'mock', mockPayment: true });
  });

  it('fails closed when real mode is missing any login, payment, or session secret', () => {
    expect(() =>
      loadWechatRuntimeConfig({
        NODE_ENV: 'production',
        WECHAT_PAY_MODE: 'wechat',
        MOCK_WECHAT_PAY: 'false',
      }),
    ).toThrow(/WECHAT_APP_ID/);
  });

  it('rejects localhost and mock coexistence in production real mode', () => {
    const complete = {
      NODE_ENV: 'production',
      WECHAT_PAY_MODE: 'wechat',
      MOCK_WECHAT_PAY: 'false',
      WECHAT_APP_ID: 'wx-app',
      WECHAT_APP_SECRET: 'app-secret',
      WECHAT_MCH_ID: 'merchant',
      WECHAT_MCH_SERIAL_NO: 'merchant-serial',
      WECHAT_PRIVATE_KEY_PATH: '/run/secrets/wechat-private.pem',
      WECHAT_API_V3_KEY: '12345678901234567890123456789012',
      WECHAT_PAY_PLATFORM_SERIAL_NO: 'platform-serial',
      WECHAT_PAY_PLATFORM_CERT_PATH: '/run/secrets/wechat-platform.pem',
      WECHAT_PAY_NOTIFY_URL: 'https://api.example.test/api/payments/wechat/notify',
      WECHAT_REFUND_NOTIFY_URL: 'https://api.example.test/api/refunds/wechat/notify',
      MINIAPP_API_BASE_URL: 'http://localhost:13080',
      USER_SESSION_TOKEN_SECRET: 'a'.repeat(32),
    };

    expect(() => loadWechatRuntimeConfig(complete)).toThrow(
      /MINIAPP_API_BASE_URL/,
    );
    expect(() =>
      loadWechatRuntimeConfig({ ...complete, MOCK_WECHAT_PAY: 'true' }),
    ).toThrow(/MOCK_WECHAT_PAY/);
  });
});
