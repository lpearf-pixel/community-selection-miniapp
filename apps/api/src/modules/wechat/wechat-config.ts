export type WechatRuntimeEnv = Record<string, string | undefined>;

export type WechatRuntimeConfig = {
  nodeEnv: string;
  paymentMode: 'mock' | 'wechat';
  mockPayment: boolean;
  appId: string;
  appSecret: string;
  merchantId: string;
  merchantSerialNo: string;
  merchantPrivateKeyPath: string;
  apiV3Key: string;
  platformSerialNo: string;
  platformCertificatePath: string;
  paymentNotifyUrl: string;
  refundNotifyUrl: string;
  miniappApiBaseUrl: string;
  sessionTokenSecret: string;
};

const REAL_MODE_KEYS = [
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'WECHAT_MCH_ID',
  'WECHAT_MCH_SERIAL_NO',
  'WECHAT_PRIVATE_KEY_PATH',
  'WECHAT_API_V3_KEY',
  'WECHAT_PAY_PLATFORM_SERIAL_NO',
  'WECHAT_PAY_PLATFORM_CERT_PATH',
  'WECHAT_PAY_NOTIFY_URL',
  'WECHAT_REFUND_NOTIFY_URL',
  'MINIAPP_API_BASE_URL',
  'USER_SESSION_TOKEN_SECRET',
] as const;

function requireValue(env: WechatRuntimeEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required in WeChat real mode`);
  return value;
}

function assertPublicHttpsUrl(value: string, key: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTPS URL`);
  }
  const hostname = url.hostname.toLowerCase();
  const isPrivate =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local') ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
  if (url.protocol !== 'https:' || isPrivate) {
    throw new Error(`${key} must use public HTTPS in WeChat real mode`);
  }
}

export function loadWechatRuntimeConfig(
  env: WechatRuntimeEnv = process.env,
): WechatRuntimeConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const paymentMode = env.WECHAT_PAY_MODE === 'wechat' ? 'wechat' : 'mock';
  const mockPayment =
    env.MOCK_WECHAT_PAY === 'true' ||
    (env.MOCK_WECHAT_PAY !== 'false' && paymentMode === 'mock');

  if (paymentMode === 'mock') {
    return {
      nodeEnv,
      paymentMode,
      mockPayment: true,
      appId: env.WECHAT_APP_ID?.trim() ?? '',
      appSecret: env.WECHAT_APP_SECRET?.trim() ?? '',
      merchantId: env.WECHAT_MCH_ID?.trim() ?? '',
      merchantSerialNo: env.WECHAT_MCH_SERIAL_NO?.trim() ?? '',
      merchantPrivateKeyPath: env.WECHAT_PRIVATE_KEY_PATH?.trim() ?? '',
      apiV3Key: env.WECHAT_API_V3_KEY?.trim() ?? '',
      platformSerialNo: env.WECHAT_PAY_PLATFORM_SERIAL_NO?.trim() ?? '',
      platformCertificatePath:
        env.WECHAT_PAY_PLATFORM_CERT_PATH?.trim() ?? '',
      paymentNotifyUrl: env.WECHAT_PAY_NOTIFY_URL?.trim() ?? '',
      refundNotifyUrl: env.WECHAT_REFUND_NOTIFY_URL?.trim() ?? '',
      miniappApiBaseUrl: env.MINIAPP_API_BASE_URL?.trim() ?? '',
      sessionTokenSecret: env.USER_SESSION_TOKEN_SECRET?.trim() ?? '',
    };
  }

  if (mockPayment) {
    throw new Error(
      'MOCK_WECHAT_PAY must be false when WECHAT_PAY_MODE=wechat',
    );
  }
  for (const key of REAL_MODE_KEYS) requireValue(env, key);

  const config: WechatRuntimeConfig = {
    nodeEnv,
    paymentMode,
    mockPayment: false,
    appId: requireValue(env, 'WECHAT_APP_ID'),
    appSecret: requireValue(env, 'WECHAT_APP_SECRET'),
    merchantId: requireValue(env, 'WECHAT_MCH_ID'),
    merchantSerialNo: requireValue(env, 'WECHAT_MCH_SERIAL_NO'),
    merchantPrivateKeyPath: requireValue(env, 'WECHAT_PRIVATE_KEY_PATH'),
    apiV3Key: requireValue(env, 'WECHAT_API_V3_KEY'),
    platformSerialNo: requireValue(env, 'WECHAT_PAY_PLATFORM_SERIAL_NO'),
    platformCertificatePath: requireValue(
      env,
      'WECHAT_PAY_PLATFORM_CERT_PATH',
    ),
    paymentNotifyUrl: requireValue(env, 'WECHAT_PAY_NOTIFY_URL'),
    refundNotifyUrl: requireValue(env, 'WECHAT_REFUND_NOTIFY_URL'),
    miniappApiBaseUrl: requireValue(env, 'MINIAPP_API_BASE_URL'),
    sessionTokenSecret: requireValue(env, 'USER_SESSION_TOKEN_SECRET'),
  };

  if (config.apiV3Key.length !== 32) {
    throw new Error('WECHAT_API_V3_KEY must be exactly 32 characters');
  }
  if (config.sessionTokenSecret.length < 32) {
    throw new Error('USER_SESSION_TOKEN_SECRET must be at least 32 characters');
  }
  assertPublicHttpsUrl(config.paymentNotifyUrl, 'WECHAT_PAY_NOTIFY_URL');
  assertPublicHttpsUrl(config.refundNotifyUrl, 'WECHAT_REFUND_NOTIFY_URL');
  assertPublicHttpsUrl(config.miniappApiBaseUrl, 'MINIAPP_API_BASE_URL');

  return config;
}
