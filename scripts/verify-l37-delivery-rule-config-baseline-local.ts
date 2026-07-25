import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

assertStageRegistered('L37', 'scripts/verify-l37-delivery-rule-config-baseline-local.ts');
function read(path: string) { return readFileSync(path, 'utf8'); }
function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }
function includesAll(source: string, needles: string[], label: string) { for (const needle of needles) assert(source.includes(needle), `${label} missing: ${needle}`); }
function exists(path: string) { assert(existsSync(path), `missing file: ${path}`); }

const files = ['prisma/schema.prisma','apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/routes/public/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','scripts/verify-l37-delivery-rule-config-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l37-delivery-rule-config-baseline.md'];
files.forEach(exists);
assert(readdirSync('prisma/migrations', { withFileTypes: true }).some((entry) => entry.isDirectory() && entry.name.endsWith('_l37_delivery_rule_config')), 'missing L37 migration');
const schema = read('prisma/schema.prisma');
includesAll(schema, ['model DeliveryRuleConfig','pickup_store_id','base_fee_cents','free_threshold_cents','service_radius_text','notice','time_windows_json','enabled','@@index([pickup_store_id])'], 'schema');
const service = read('apps/api/src/modules/delivery/delivery-rule-service.ts');
includesAll(service, ['getDeliveryRule','validateDeliveryRuleForOrder','listDeliveryRuleConfigs','upsertDeliveryRuleConfig','disableDeliveryRuleConfig','pickup_store_id','global_default','fallback','base_fee_cents','free_threshold_cents','available_time_windows','delivery_time_window_code'], 'service');
const api = read('apps/api/src/routes/admin/delivery.ts') + read('apps/api/src/routes/public/delivery.ts');
includesAll(api, ['/api/delivery/rules','/api/admin/delivery/rules','/api/admin/delivery/rule-configs','/api/admin/delivery/rule-configs/:id','/api/admin/delivery/rule-configs/:id/disable','requireAdminPermission','system.manage','order.manage'], 'api');
const admin = read('apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx') + read('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx') + read('apps/admin/src/api/delivery.ts');
includesAll(admin, ['DeliveryRuleConfigPage','配送规则配置','全局默认规则','自提点规则','base_fee_cents','free_threshold_cents','service_radius_text','available_time_windows','禁用','保存','管理配送规则'], 'admin');
const mini = read('apps/miniapp/pages/orders/confirm/index.js') + read('apps/miniapp/pages/orders/confirm/index.wxml');
includesAll(mini, ['/api/delivery/rules','pickup_store_id','该自提点暂不支持门店配送','配送费','配送时段','配送范围','delivery_time_window_code'], 'miniapp');

const deliveryRuntimeFiles = [
  'apps/api/src/modules/delivery/delivery-rule-service.ts',
  'apps/api/src/routes/admin/delivery.ts',
  'apps/api/src/routes/public/delivery.ts',
  'apps/admin/src/api/delivery.ts',
  'apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx',
  'apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',
  'apps/miniapp/pages/orders/confirm/index.js',
  'apps/miniapp/pages/orders/confirm/index.wxml'
];
const deliveryRuntimeSource = deliveryRuntimeFiles.map(read).join('\n');
function assertNoDadaIntegration(source: string, label: string) {
  const dadaPatterns = [
    /https?:\/\/[^\s'"]*newopen\.imdada\.cn/i,
    /\bDADA_SOURCE_ID\b/,
    /\bDADA_APP_KEY\b/,
    /\bDADA_APP_SECRET\b/,
    /from\s+['"][^'"]*dada[^'"]*['"]/i,
    /require\(['"][^'"]*dada[^'"]*['"]\)/i,
    /dada[^\n]{0,80}(sign|signature)|(?:sign|signature)[^\n]{0,80}dada/i,
    /(fetch|request|axios\.(?:get|post|put|request))\s*\([^\n]{0,160}newopen\.imdada\.cn/i
  ];
  for (const pattern of dadaPatterns) assert(!pattern.test(source), `${label} contains forbidden Dada integration marker: ${pattern}`);
}
assertNoDadaIntegration(deliveryRuntimeSource, 'L37 scoped delivery runtime files');
assertNoDadaIntegration('const source_id = "local"; const signature = "local"; const app_key = "local"; fetch("/api/delivery/rules"); request("/api/admin/delivery/rules");', 'ordinary non-Dada fixture');
for (const fixture of ['https://newopen.imdada.cn/api/order/add', 'const DADA_SOURCE_ID = "x";', 'const DADA_APP_KEY = "x";', 'const DADA_APP_SECRET = "x";', 'import dada from "dada-sdk";', 'const dadaSignature = sign(payload);', 'fetch("https://newopen.imdada.cn/api/order/add")']) {
  let rejected = false;
  try { assertNoDadaIntegration(fixture, 'Dada negative fixture'); } catch { rejected = true; }
  assert(rejected, `Dada fixture must be rejected: ${fixture}`);
}
const safetyFiles = ['apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/routes/public/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx'];
for (const f of safetyFiles) {
  const source = read(f).replaceAll('receiver_phone_masked','').replaceAll('pickup_store_phone','').replaceAll('receiver_address_masked','').replaceAll('delivery_fee_cents','');
  for (const word of ['cost_price_' + 'cents','commission_' + 'value','commission_' + 'type','stock_deduct_' + 'quantity','password_' + 'hash','private_' + 'key','before_' + 'snapshot','after_' + 'snapshot','raw user ' + 'profile']) assert(!source.includes(word), `${f} exposes ${word}`);
}
console.log('Compliance scan passed.');
console.log('L37 delivery rule config baseline verification passed.');
