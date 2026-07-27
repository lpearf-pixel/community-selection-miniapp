import { existsSync, readFileSync } from 'node:fs';

const failures: string[] = [];

function read(path: string) {
  if (!existsSync(path)) {
    failures.push(`${path} is required`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

const requiredFiles = [
  'apps/api/src/modules/wechat/wechat-config.ts',
  'apps/api/src/modules/wechat/wechat-login-client.ts',
  'apps/api/src/modules/wechat/wechat-pay-v3-client.ts',
  'apps/api/src/modules/wechat/wechat-notify-verifier.ts',
  'apps/api/src/modules/wechat/wechat-reconciler.ts',
  'apps/api/src/modules/payment/wechat-payment-command.ts',
  'apps/api/src/modules/payment/wechat-payment-notification.ts',
  'apps/api/src/modules/refund/wechat-refund-command.ts',
  'apps/api/src/modules/refund/wechat-refund-notification.ts',
  'apps/api/src/modules/group-buy/wechat-group-expiry-command.ts',
  'apps/api/src/modules/operations/ops-alert-owner.ts',
  'apps/miniapp/utils/session.js',
  'apps/miniapp/utils/payment.js',
  'prisma/migrations/202607270001_l51_wechat_commerce_loop/migration.sql',
];

for (const path of requiredFiles) read(path);

const schema = read('prisma/schema.prisma');
const paymentRoutes = read('apps/api/src/routes/payments.ts');
const refundRoutes = read('apps/api/src/routes/refunds.ts');
const orderRoutes = read('apps/api/src/routes/group-buys.ts');
const miniappConfig = read('apps/miniapp/config.js');
const miniappApi = read('apps/miniapp/utils/api.js');
const checkout = read('apps/miniapp/pages/orders/confirm/index.js');
const joinOrder = read('apps/miniapp/pages/join-order/index.js');
const payment = read('apps/miniapp/utils/payment.js');
const packageJson = read('package.json');

for (const model of [
  'model UserSession',
  'model WechatNotificationReceipt',
  'dedupe_key',
  'provider_success_at',
  'provider_status',
]) {
  if (!schema.includes(model)) failures.push(`schema missing ${model}`);
}
if (/\sraw_notify\s+Json\?/.test(schema)) {
  failures.push('Payment and Refund must not retain raw_notify');
}
for (const route of [
  '/api/payments/wechat/jsapi',
  '/api/payments/wechat/notify',
  '/api/refunds/wechat/notify',
]) {
  if (!(paymentRoutes + refundRoutes).includes(route)) {
    failures.push(`missing route ${route}`);
  }
}
if (!paymentRoutes.includes('request.rawBody')) {
  failures.push('payment notification must use exact raw body');
}
if (!refundRoutes.includes('request.rawBody')) {
  failures.push('refund notification must use exact raw body');
}
if (!orderRoutes.includes('withCurrentUser')) {
  failures.push('order creation must use the server session user');
}
if (!miniappApi.includes('Authorization')) {
  failures.push('miniapp API helper must inject Bearer authorization');
}
if (!payment.includes('wx_request_payment') ||
    !payment.includes('requestPayment') ||
    !payment.includes('payment-status')) {
  failures.push('miniapp payment flow must initialize, invoke, and poll');
}
for (const source of [checkout, joinOrder]) {
  if (/\buser_(?:id|openid)\s*:/.test(source)) {
    failures.push('miniapp checkout must not send client identity fields');
  }
  if (source.includes('/api/payments/mock')) {
    failures.push('checkout pages must not call mock payment directly');
  }
}
if (/apiBaseUrl\s*:\s*['"]http:\/\/(?:localhost|127\.0\.0\.1)/.test(miniappConfig)) {
  failures.push('miniapp production config must not hardcode localhost');
}
if (!packageJson.includes('"verify:l51"')) {
  failures.push('package scripts must expose verify:l51');
}
for (const path of [
  '.github/workflows/l51-workspace-recovery.yml',
  '.github/l51-workspace-recovery.trigger',
]) {
  if (existsSync(path)) failures.push(`${path} must be deleted`);
}

if (failures.length > 0) {
  throw new Error(
    `L51 WeChat commerce verification failed:\n- ${[
      ...new Set(failures),
    ].join('\n- ')}`,
  );
}

console.log('L51 WeChat commerce static verification passed.');
