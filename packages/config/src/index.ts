export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 13080),
  mockWechatPay: process.env.MOCK_WECHAT_PAY !== 'false' && process.env.WECHAT_PAY_MODE !== 'wechat',
  adminAuthEnabled: process.env.ADMIN_AUTH_ENABLED === 'true',
  adminToken: process.env.ADMIN_TOKEN ?? ''
} as const;

export function validateRuntimeConfig() {
  const problems: string[] = [];
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (!process.env.PORT) problems.push('PORT is required');
  if (config.adminAuthEnabled && !config.adminToken) problems.push('ADMIN_TOKEN is required when admin auth is enabled');
  if (!config.mockWechatPay) {
    for (const key of [
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
    ]) {
      if (!process.env[key]) problems.push(`${key} is required when WeChat Pay real mode is enabled`);
    }
  }
  if (process.env.AUTO_PAYOUT_ENABLED === 'true') problems.push('AUTO_PAYOUT_ENABLED must stay disabled');
  if (process.env.AUTO_TAX_FILING_ENABLED === 'true') problems.push('AUTO_TAX_FILING_ENABLED must stay disabled');
  if (problems.length > 0) throw new Error(`配置校验失败：${problems.join('; ')}`);
}
