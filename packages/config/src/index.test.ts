import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './index.js';

const validProductionEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PORT: '13080',
  DATABASE_URL:
    'postgresql://community_selection:strong_database_password@postgres:5432/community_selection?schema=public',
  API_DOMAIN: 'api.example.com',
  ADMIN_DOMAIN: 'admin.example.com',
  ADMIN_AUTH_ENABLED: 'true',
  ADMIN_AUTH_MODE: 'session',
  ADMIN_TOKEN: 'admin-token-abcdefghijklmnopqrstuvwxyz',
  ADMIN_TOTP_ENCRYPTION_KEY: 'totp-key-abcdefghijklmnopqrstuvwxyz12',
  WECHAT_PAY_MODE: 'wechat',
  MOCK_WECHAT_PAY: 'false',
  WECHAT_APP_ID: 'wx-production-app-id',
  WECHAT_APP_SECRET: 'wechat-app-secret-abcdefghijklmnop',
  WECHAT_MCH_ID: '1900000001',
  WECHAT_MCH_SERIAL_NO: 'SERIAL123456',
  WECHAT_API_V3_KEY: '12345678901234567890123456789012',
  WECHAT_PRIVATE_KEY_PATH: '/run/secrets/wechat_private_key.pem',
  WECHAT_PAY_PLATFORM_SERIAL_NO: 'PLATFORM123456',
  WECHAT_PAY_PLATFORM_CERT_PATH:
    '/run/secrets/wechat_platform_certificate.pem',
  WECHAT_PAY_NOTIFY_URL:
    'https://api.example.com/api/payments/wechat/notify',
  WECHAT_REFUND_NOTIFY_URL:
    'https://api.example.com/api/refunds/wechat/notify',
  MINIAPP_API_BASE_URL: 'https://api.example.com',
  USER_SESSION_TOKEN_SECRET:
    'user-session-secret-abcdefghijklmnopqrstuvwxyz',
  CURRENT_USER_MOCK_HEADERS_ENABLED: 'false',
  AUTO_PAYOUT_ENABLED: 'false',
  AUTO_TAX_FILING_ENABLED: 'false',
  WECHAT_TRANSFER_ENABLED: 'false',
  WECHAT_MERCHANT_TRANSFER_ENABLED: 'false',
};

describe('production runtime configuration', () => {
  it('accepts the complete real-payment single-server contract', () => {
    expect(() => validateRuntimeConfig(validProductionEnv)).not.toThrow();
  });

  it.each([
    ['MOCK_WECHAT_PAY', 'true', /MOCK_WECHAT_PAY/],
    ['WECHAT_PAY_MODE', 'mock', /WECHAT_PAY_MODE/],
    [
      'CURRENT_USER_MOCK_HEADERS_ENABLED',
      'true',
      /CURRENT_USER_MOCK_HEADERS_ENABLED/,
    ],
    ['ADMIN_AUTH_ENABLED', 'false', /ADMIN_AUTH_ENABLED/],
    ['ADMIN_AUTH_MODE', 'token', /ADMIN_AUTH_MODE/],
    ['AUTO_PAYOUT_ENABLED', 'true', /AUTO_PAYOUT_ENABLED/],
    ['AUTO_TAX_FILING_ENABLED', 'true', /AUTO_TAX_FILING_ENABLED/],
    ['WECHAT_TRANSFER_ENABLED', 'true', /WECHAT_TRANSFER_ENABLED/],
    [
      'WECHAT_MERCHANT_TRANSFER_ENABLED',
      'true',
      /WECHAT_MERCHANT_TRANSFER_ENABLED/,
    ],
  ])('rejects unsafe production switch %s=%s', (key, value, message) => {
    expect(() =>
      validateRuntimeConfig({ ...validProductionEnv, [key]: value }),
    ).toThrow(message);
  });

  it.each([
    ['ADMIN_TOKEN', 'short', /ADMIN_TOKEN/],
    ['ADMIN_TOTP_ENCRYPTION_KEY', 'short', /ADMIN_TOTP_ENCRYPTION_KEY/],
    ['USER_SESSION_TOKEN_SECRET', 'short', /USER_SESSION_TOKEN_SECRET/],
    ['WECHAT_API_V3_KEY', 'short', /WECHAT_API_V3_KEY/],
  ])('rejects weak production secret %s', (key, value, message) => {
    expect(() =>
      validateRuntimeConfig({ ...validProductionEnv, [key]: value }),
    ).toThrow(message);
  });

  it('rejects reused Admin token and TOTP encryption key', () => {
    expect(() =>
      validateRuntimeConfig({
        ...validProductionEnv,
        ADMIN_TOTP_ENCRYPTION_KEY: validProductionEnv.ADMIN_TOKEN,
      }),
    ).toThrow(/must be independent/);
  });

  it('rejects using the same public domain for API and Admin', () => {
    expect(() =>
      validateRuntimeConfig({
        ...validProductionEnv,
        ADMIN_DOMAIN: validProductionEnv.API_DOMAIN,
      }),
    ).toThrow(/API_DOMAIN.*ADMIN_DOMAIN|ADMIN_DOMAIN.*API_DOMAIN/);
  });

  it.each([
    ['API_DOMAIN', 'http://api.example.com', /API_DOMAIN/],
    ['ADMIN_DOMAIN', 'localhost', /ADMIN_DOMAIN/],
    [
      'WECHAT_PAY_NOTIFY_URL',
      'http://api.example.com/pay-notify',
      /WECHAT_PAY_NOTIFY_URL/,
    ],
    [
      'MINIAPP_API_BASE_URL',
      'https://wrong.example.com',
      /MINIAPP_API_BASE_URL/,
    ],
    [
      'WECHAT_PRIVATE_KEY_PATH',
      '/var/private/private-key.pem',
      /WECHAT_PRIVATE_KEY_PATH/,
    ],
    [
      'WECHAT_PAY_PLATFORM_CERT_PATH',
      '/opt/private/cert.pem',
      /WECHAT_PAY_PLATFORM_CERT_PATH/,
    ],
  ])('rejects unsafe production endpoint or path %s', (key, value, message) => {
    expect(() =>
      validateRuntimeConfig({ ...validProductionEnv, [key]: value }),
    ).toThrow(message);
  });

  it('reports every missing real WeChat setting together', () => {
    const env = { ...validProductionEnv };
    delete env.WECHAT_APP_SECRET;
    delete env.WECHAT_MCH_ID;

    expect(() => validateRuntimeConfig(env)).toThrow(
      /WECHAT_APP_SECRET.*WECHAT_MCH_ID/,
    );
  });
});
