import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanComplianceFiles } from './lib/compliance-scan';

assertStageRegistered('L26', 'scripts/verify-l26-group-buy-success-rule-local.ts');
const repoRoot = process.cwd();
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function read(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

const requiredFiles = [
  'apps/api/src/modules/order/order-service.ts',
  'apps/api/src/services/payment-service.ts',
  'apps/api/src/routes/payments.ts',
  'apps/api/src/modules/user-products/user-product-service.ts',
  'apps/api/src/routes/group-buys.ts',
  'apps/miniapp/pages/group-buy-detail/index.js',
  'apps/miniapp/pages/group-buy-detail/index.wxml',
  'scripts/verify-l26-group-buy-success-rule-local.ts',
  'docs/reviews/l26-group-buy-success-rule.md',
  'scripts/generate-stage-report.ts'
];
for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `missing required file: ${file}`);

const backend = [
  'apps/api/src/services/payment-service.ts',
  'apps/api/src/routes/payments.ts',
  'apps/api/src/modules/user-products/user-product-service.ts',
  'apps/api/src/routes/group-buys.ts'
].map(read).join('\n');
const successRuleSource = read('apps/api/src/services/payment-service.ts') + read('apps/api/src/modules/user-products/user-product-service.ts');

const requiredBackendKeywords = [
  'group_buy_id',
  'pay_status',
  'paid',
  'target_count',
  'quantity',
  'success',
  'refreshGroupBuySuccessState',
  '/api/payments/mock'
];
for (const keyword of requiredBackendKeywords) assert(backend.includes(keyword), `backend missing keyword: ${keyword}`);

const forbiddenBasis = [
  'view_count',
  'click_count',
  'share_count',
  'unpaid_count',
  'created_order_count'
];
for (const keyword of forbiddenBasis) assert(!successRuleSource.includes(keyword), `must not use ${keyword} as success basis`);

assert(/pay_status\s*:\s*['"]paid['"]/.test(backend), 'success refresh must filter pay_status paid');
assert(/_sum\s*:\s*\{\s*quantity\s*:\s*true\s*\}/.test(backend) || /reduce\([^)]*quantity/.test(backend), 'success refresh must aggregate paid quantity');
assert(backend.includes('group_buy_id') && backend.includes('target_count') && backend.includes("status: 'success'"), 'success refresh must connect group_buy_id, target_count, and status success');
assert(backend.includes("order_status: { notIn: ['closed', 'refunded'] }") || backend.includes('closed') && backend.includes('refunded'), 'closed/refunded orders must be excluded');
assert(backend.includes("refund_status: { notIn: ['success'] }"), 'successful refund status must be excluded');

const groupBuyRoute = read('apps/api/src/routes/group-buys.ts');
const safeDetailStart = groupBuyRoute.indexOf('async function toSafeGroupBuyDetail');
const safeDetailEnd = groupBuyRoute.indexOf('type CloneGroupBuyBody');
assert(safeDetailStart >= 0 && safeDetailEnd > safeDetailStart, 'safe group buy detail mapper must exist');
const publicMapper = read('apps/api/src/modules/user-products/user-product-service.ts') + groupBuyRoute.slice(safeDetailStart, safeDetailEnd);
for (const keyword of ['cost_' + 'price_cents', 'commission_' + 'value', 'commission_' + 'type', 'stock_' + 'deduct_quantity', 'receiver_' + 'phone', 'before_' + 'snapshot', 'after_' + 'snapshot']) {
  assert(!publicMapper.includes(keyword), `public group buy response must not expose ${keyword}`);
}

const miniapp = [
  'apps/miniapp/pages/group-buy-detail/index.js',
  'apps/miniapp/pages/group-buy-detail/index.wxml',
  'apps/miniapp/pages/start-group-buy/index.js',
  'apps/miniapp/pages/join-order/index.js'
].map(read).join('\n');
for (const keyword of ['邀请' + '返利', '拉人' + '赚钱', '下' + '级', '上' + '级', '团队' + '收益', '代理' + '收益', '多级' + '分销', '裂' + '变奖励']) {
  assert(!miniapp.includes(keyword), `miniapp forbidden copy found: ${keyword}`);
}
for (const keyword of ['分享团购', '满', '成团', '还差']) assert(miniapp.includes(keyword), `miniapp missing allowed copy: ${keyword}`);

scanComplianceFiles([
  'apps/api/src/modules/order/order-service.ts',
  'apps/api/src/routes/payments.ts',
  'apps/api/src/services/payment-service.ts',
  'apps/miniapp/pages/group-buy-detail/index.js',
  'apps/miniapp/pages/group-buy-detail/index.wxml',
  'apps/miniapp/pages/start-group-buy/index.js',
  'apps/miniapp/pages/join-order/index.js',
  'scripts/verify-l26-group-buy-success-rule-local.ts',
  'docs/reviews/l26-group-buy-success-rule.md'
]);
console.log('Compliance scan passed.');
console.log('L26 group buy success rule verification passed.');
