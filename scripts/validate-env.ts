type EnvMode = 'development' | 'test' | 'production';

const env = process.env.NODE_ENV as EnvMode | undefined;
const nodeEnv = env ?? 'development';
const payMode = process.env.WECHAT_PAY_MODE ?? 'mock';
const mockWechatPay = process.env.MOCK_WECHAT_PAY !== 'false' && payMode !== 'wechat';
const requiredBase = ['DATABASE_URL', 'PORT', 'ADMIN_TOKEN'];
const requiredWechat = ['WECHAT_APP_ID', 'WECHAT_MCH_ID', 'WECHAT_MCH_SERIAL_NO', 'WECHAT_API_V3_KEY', 'WECHAT_PRIVATE_KEY_PATH', 'WECHAT_PAY_NOTIFY_URL'];
const forbiddenRealPayout = ['WECHAT_TRANSFER_ENABLED', 'WECHAT_MERCHANT_TRANSFER_ENABLED', 'AUTO_PAYOUT_ENABLED'];
const problems: string[] = [];

for (const key of requiredBase) {
  if (!process.env[key]) problems.push(`Missing required env: ${key}`);
}

if (!['mock', 'wechat'].includes(payMode)) problems.push('WECHAT_PAY_MODE must be mock or wechat');
if (nodeEnv === 'production' && !process.env.ADMIN_AUTH_ENABLED) problems.push('Production should set ADMIN_AUTH_ENABLED explicitly');

if (!mockWechatPay) {
  for (const key of requiredWechat) {
    if (!process.env[key]) problems.push(`Missing required WeChat Pay env in real mode: ${key}`);
  }
}

for (const key of forbiddenRealPayout) {
  if (process.env[key] === 'true') problems.push(`${key} must not be enabled in this version`);
}

if (process.env.AUTO_TAX_FILING_ENABLED === 'true') problems.push('AUTO_TAX_FILING_ENABLED must not be enabled in this version');
if (process.env.WECHAT_PRIVATE_KEY_PATH?.startsWith(`/${'Users'}/`) || process.env.WECHAT_PRIVATE_KEY_PATH?.startsWith(`/${'root'}/`)) {
  problems.push('WECHAT_PRIVATE_KEY_PATH should not use a local absolute personal path');
}

if (problems.length > 0) {
  console.error('Environment validation failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Environment validation passed for ${nodeEnv}, payment mode: ${mockWechatPay ? 'mock' : 'wechat'}.`);
