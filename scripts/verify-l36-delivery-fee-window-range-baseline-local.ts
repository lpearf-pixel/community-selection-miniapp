import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

assertStageRegistered('L36', 'scripts/verify-l36-delivery-fee-window-range-baseline-local.ts');
const root = process.cwd();
function exists(p: string) { return existsSync(join(root, p)); }
function read(p: string) { return readFileSync(join(root, p), 'utf8'); }
function mustFile(p: string) { if (!exists(p)) throw new Error(`Missing file: ${p}`); }
function mustInclude(p: string, terms: string[]) { const s = read(p); for (const t of terms) if (!s.includes(t)) throw new Error(`${p} missing ${t}`); }
function mustNotText(label: string, text: string, patterns: Array<[string, RegExp]>) { for (const [name, pattern] of patterns) if (pattern.test(text)) throw new Error(`${label} contains forbidden ${name}`); }

const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: root, encoding: 'utf8' });
process.stdout.write(compliance.stdout);
process.stderr.write(compliance.stderr);
if (compliance.status !== 0) throw new Error('Compliance scan failed');

const files = [
  'apps/api/src/modules/delivery/delivery-rule-service.ts',
  'apps/api/src/modules/order/order-service.ts',
  'apps/api/src/modules/user-orders/user-order-service.ts',
  'apps/admin/src/api/delivery.ts',
  'apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',
  'apps/miniapp/pages/orders/confirm/index.js',
  'apps/miniapp/pages/orders/confirm/index.wxml',
  'apps/miniapp/pages/orders/detail/index.js',
  'scripts/verify-l36-delivery-fee-window-range-baseline-local.ts',
  'scripts/verify-all-local.sh',
  'scripts/stage-workflow.ts',
  'scripts/generate-stage-report.ts',
  'docs/reviews/l36-delivery-fee-window-range-baseline.md'
];
files.forEach(mustFile);

mustInclude('apps/api/src/modules/delivery/delivery-rule-service.ts', [
  'getDeliveryRule',
  'validateDeliveryRuleForOrder',
  'base_fee_cents',
  'free_threshold_cents',
  'service_radius_text',
  'available_time_windows',
  'delivery_time_window_code'
]);
mustInclude('apps/api/src/routes/public/delivery.ts', ['/api/delivery/rules']);
mustInclude('apps/api/src/routes/admin/delivery.ts', ['/api/admin/delivery/rules', 'requireAdminPermission', 'order.view', 'pickup.verify']);

const orderServiceSource = read('apps/api/src/modules/order/order-service.ts');
mustInclude('apps/api/src/modules/order/order-service.ts', [
  'pickup_type',
  'delivery_time_window_code',
  'delivery_time_window_text',
  'validateDeliveryRuleForOrder',
  'receiver_phone_masked',
  'receiver_address_masked'
]);
if (!orderServiceSource.includes("pickupType === 'delivery'") && !orderServiceSource.includes("pickup_type === 'delivery'")) {
  throw new Error("apps/api/src/modules/order/order-service.ts missing delivery pickup branch");
}

mustInclude('apps/miniapp/pages/orders/confirm/index.js', ['delivery_time_window_code', 'delivery_fee_cents', 'deliveryRule', 'free_threshold_cents']);
mustInclude('apps/miniapp/pages/orders/confirm/index.wxml', ['门店配送', '配送范围', '配送费', '配送时段', 'delivery_time_window_code']);
mustInclude('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx', ['配送规则', '配送范围', '配送时段', '配送费', '达达接口未启用']);

const deliveryFiles = [
  'apps/api/src/modules/delivery/delivery-rule-service.ts',
  'apps/api/src/modules/delivery/delivery-service.ts',
  'apps/api/src/modules/delivery/dada-adapter.ts',
  'apps/api/src/routes/admin/delivery.ts',
  'apps/api/src/routes/public/delivery.ts',
  'apps/api/src/modules/order/order-service.ts'
].filter(exists);
const joinedDeliverySource = deliveryFiles.map(read).join('\n');
const sourceId = 'source' + '_id';
const appSecretPattern = new RegExp('app' + '[_-]?' + 'secret', 'i');
const appKeyPattern = new RegExp('app' + '[_-]?' + 'key', 'i');
mustNotText('delivery related source', joinedDeliverySource, [
  ['real dada gateway', /newopen\.imdada\.cn|api\.imdada\.cn/i],
  ['app secret', appSecretPattern],
  ['app key', appKeyPattern],
  ['dada source id', new RegExp(`dada[\\s\\S]{0,120}${sourceId}|${sourceId}[\\s\\S]{0,120}dada`, 'i')],
  ['signature near dada', /signature[\s\S]{0,120}(dada|imdada)|(dada|imdada)[\s\S]{0,120}signature/i],
  ['axios post to dada', /axios\.post[\s\S]{0,160}(dada|imdada)/i],
  ['fetch to dada', /fetch\([\s\S]{0,160}(dada|imdada)/i],
  ['request to dada', /request\([\s\S]{0,160}(dada|imdada)/i],
  ['real delivery order', /create\s+real\s+delivery\s+order/i]
]);

console.log('Compliance scan passed.');
console.log('L36 delivery fee window range baseline verification passed.');
