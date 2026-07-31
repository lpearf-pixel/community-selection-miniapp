type RuntimeEnv = NodeJS.ProcessEnv;

const realWechatKeys = [
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'WECHAT_MCH_ID',
  'WECHAT_MCH_SERIAL_NO',
  'WECHAT_API_V3_KEY',
  'WECHAT_PRIVATE_KEY_PATH',
  'WECHAT_PAY_PLATFORM_SERIAL_NO',
  'WECHAT_PAY_PLATFORM_CERT_PATH',
  'WECHAT_PAY_NOTIFY_URL',
  'WECHAT_REFUND_NOTIFY_URL',
  'MINIAPP_API_BASE_URL',
  'USER_SESSION_TOKEN_SECRET',
] as const;

const firstLaunchDisabledKeys = [
  'MEMBERSHIP_ENABLED',
  'COUPONS_ENABLED',
  'CASH_REWARDS_ENABLED',
  'WITHDRAWALS_ENABLED',
] as const;

const disabledAutomationKeys = [
  'AUTO_PAYOUT_ENABLED',
  'AUTO_TAX_FILING_ENABLED',
  'WECHAT_TRANSFER_ENABLED',
  'WECHAT_MERCHANT_TRANSFER_ENABLED',
] as const;

function isHostname(value: string | undefined) {
  if (!value || value === 'localhost' || value.includes('://')) return false;
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value);
}

function isHttpsUrl(value: string | undefined, expectedOrigin?: string) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      (!expectedOrigin || parsed.origin === expectedOrigin)
    );
  } catch {
    return false;
  }
}

function requireLength(
  env: RuntimeEnv,
  key: string,
  minimum: number,
  problems: string[],
) {
  if ((env[key]?.length ?? 0) < minimum) {
    problems.push(`${key} must be at least ${minimum} characters`);
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 13080),
  mockWechatPay:
    process.env.MOCK_WECHAT_PAY !== 'false' &&
    process.env.WECHAT_PAY_MODE !== 'wechat',
  adminAuthEnabled: process.env.ADMIN_AUTH_ENABLED === 'true',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  memberPhoneHmacSecret: process.env.MEMBER_PHONE_HMAC_SECRET ?? '',
} as const;

export function validateRuntimeConfig(env: RuntimeEnv = process.env) {
  const problems: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  const production = nodeEnv === 'production';
  const port = Number(env.PORT);
  const payMode = env.WECHAT_PAY_MODE ?? 'mock';
  const mockWechatPay =
    env.MOCK_WECHAT_PAY !== 'false' && payMode !== 'wechat';
  const authMode =
    env.ADMIN_AUTH_MODE ?? (production ? 'session' : 'token');

  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (
    !env.PORT ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    problems.push('PORT must be an integer between 1 and 65535');
  }
  if (!['mock', 'wechat'].includes(payMode)) {
    problems.push('WECHAT_PAY_MODE must be mock or wechat');
  }
  if (!['token', 'session'].includes(authMode)) {
    problems.push('ADMIN_AUTH_MODE must be token or session');
  }
  if (env.ADMIN_AUTH_ENABLED === 'true' && !env.ADMIN_TOKEN) {
    problems.push('ADMIN_TOKEN is required when admin auth is enabled');
  }

  if (!mockWechatPay) {
    for (const key of realWechatKeys) {
      if (!env[key]?.trim()) problems.push(`${key} is required in real mode`);
    }
    if (env.MOCK_WECHAT_PAY === 'true') {
      problems.push('MOCK_WECHAT_PAY must be false in real mode');
    }
  }

  for (const key of disabledAutomationKeys) {
    if (env[key] === 'true') problems.push(`${key} must stay disabled`);
  }

  if (production) {
    if (env.FIRST_LAUNCH_MODE !== 'true') {
      problems.push('Production requires FIRST_LAUNCH_MODE=true');
    }
    for (const key of firstLaunchDisabledKeys) {
      if (env[key] !== 'false') {
        problems.push(`Production first launch requires ${key}=false`);
      }
    }
    if (env.ADMIN_AUTH_ENABLED !== 'true') {
      problems.push('Production requires ADMIN_AUTH_ENABLED=true');
    }
    if (authMode !== 'session') {
      problems.push('Production requires ADMIN_AUTH_MODE=session');
    }
    if (payMode !== 'wechat') {
      problems.push('Production requires WECHAT_PAY_MODE=wechat');
    }
    if (env.MOCK_WECHAT_PAY !== 'false') {
      problems.push('Production requires MOCK_WECHAT_PAY=false');
    }
    if (env.CURRENT_USER_MOCK_HEADERS_ENABLED === 'true') {
      problems.push(
        'Production forbids CURRENT_USER_MOCK_HEADERS_ENABLED=true',
      );
    }

    requireLength(env, 'ADMIN_TOKEN', 32, problems);
    requireLength(env, 'ADMIN_TOTP_ENCRYPTION_KEY', 32, problems);
    requireLength(env, 'USER_SESSION_TOKEN_SECRET', 32, problems);
    requireLength(env, 'MEMBER_PHONE_HMAC_SECRET', 32, problems);
    if ((env.WECHAT_API_V3_KEY?.length ?? 0) !== 32) {
      problems.push('WECHAT_API_V3_KEY must be exactly 32 characters');
    }
    if (
      env.ADMIN_TOKEN &&
      env.ADMIN_TOKEN === env.ADMIN_TOTP_ENCRYPTION_KEY
    ) {
      problems.push(
        'ADMIN_TOKEN and ADMIN_TOTP_ENCRYPTION_KEY must be independent',
      );
    }
    if (
      env.USER_SESSION_TOKEN_SECRET &&
      [
        env.ADMIN_TOKEN,
        env.ADMIN_TOTP_ENCRYPTION_KEY,
        env.WECHAT_API_V3_KEY,
      ].includes(env.USER_SESSION_TOKEN_SECRET)
    ) {
      problems.push('USER_SESSION_TOKEN_SECRET must be independent');
    }

    if (!isHostname(env.API_DOMAIN)) {
      problems.push('API_DOMAIN must be a public hostname without a scheme');
    }
    if (!isHostname(env.ADMIN_DOMAIN)) {
      problems.push(
        'ADMIN_DOMAIN must be a public hostname without a scheme',
      );
    }
    if (
      env.API_DOMAIN &&
      env.ADMIN_DOMAIN &&
      env.API_DOMAIN.toLowerCase() === env.ADMIN_DOMAIN.toLowerCase()
    ) {
      problems.push('API_DOMAIN and ADMIN_DOMAIN must be different');
    }
    const apiOrigin = isHostname(env.API_DOMAIN)
      ? `https://${env.API_DOMAIN}`
      : undefined;
    if (!isHttpsUrl(env.WECHAT_PAY_NOTIFY_URL, apiOrigin)) {
      problems.push(
        'WECHAT_PAY_NOTIFY_URL must use HTTPS on API_DOMAIN',
      );
    }
    if (!isHttpsUrl(env.WECHAT_REFUND_NOTIFY_URL, apiOrigin)) {
      problems.push(
        'WECHAT_REFUND_NOTIFY_URL must use HTTPS on API_DOMAIN',
      );
    }
    if (
      !isHttpsUrl(env.MINIAPP_API_BASE_URL, apiOrigin) ||
      env.MINIAPP_API_BASE_URL !== apiOrigin
    ) {
      problems.push(
        'MINIAPP_API_BASE_URL must equal the HTTPS API_DOMAIN origin',
      );
    }
    for (const key of [
      'WECHAT_PRIVATE_KEY_PATH',
      'WECHAT_PAY_PLATFORM_CERT_PATH',
    ] as const) {
      if (!env[key]?.startsWith('/run/secrets/')) {
        problems.push(`${key} must use a /run/secrets/ container path`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`配置校验失败：${problems.join('; ')}`);
  }
}
