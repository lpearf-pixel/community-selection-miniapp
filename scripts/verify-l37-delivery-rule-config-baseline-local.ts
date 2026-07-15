import { existsSync, readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

function read(path: string) { return readFileSync(path, 'utf8'); }
function assert(condition: unknown, message: string) { if (!condition) throw new Error(message); }
function includesAll(source: string, needles: string[], label: string) { for (const needle of needles) assert(source.includes(needle), `${label} missing: ${needle}`); }
function exists(path: string) { assert(existsSync(path), `missing file: ${path}`); }

const files = ['prisma/schema.prisma','apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/routes/public/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','scripts/verify-l37-delivery-rule-config-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l37-delivery-rule-config-baseline.md'];
files.forEach(exists);
assert(globSync('prisma/migrations/*_l37_delivery_rule_config/migration.sql').length > 0, 'missing L37 migration');
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

// L37 forbids real third-party delivery integration. Scan only the L37 delivery
// implementation surface, not shared stage/report files that later stages extend.
const deliveryIntegrationFiles = [
  'apps/api/src/modules/delivery/delivery-rule-service.ts',
  'apps/api/src/routes/admin/delivery.ts',
  'apps/api/src/routes/public/delivery.ts',
  'apps/admin/src/api/delivery.ts',
  'apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx',
  'apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',
  'apps/miniapp/pages/orders/confirm/index.js',
];
const deliveryIntegrationSurface = deliveryIntegrationFiles.map(read).join('\n');
const forbiddenIntegrations: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Dada API host', pattern: /newopen\.imdada/i },
  { label: 'Dada source credential', pattern: /\bDADA[_-]?SOURCE[_-]?ID\b/i },
  { label: 'Dada app secret', pattern: /\bDADA[_-]?APP[_-]?SECRET\b/i },
  { label: 'Dada app key', pattern: /\bDADA[_-]?APP[_-]?KEY\b/i },
  { label: 'Dada request signature', pattern: /(?:dada[\s\S]{0,80}(?:signature|sign_method)|(?:signature|sign_method)[\s\S]{0,80}dada)/i },
  { label: 'Dada SDK/import', pattern: /(?:from\s+['"][^'"]*dada|require\(\s*['"][^'"]*dada)/i },
  { label: 'real Dada HTTP request', pattern: /(?:fetch|axios\.post|request)\s*\([^\n]{0,240}newopen\.imdada/i },
  { label: 'real delivery order integration', pattern: /\breal delivery order\b/i },
];
for (const rule of forbiddenIntegrations) {
  assert(!rule.pattern.test(deliveryIntegrationSurface), `forbidden integration marker: ${rule.label}`);
}

// Guard against broad historical blacklists: generic domain fields are valid in
// later stages and must not be mistaken for provider-specific integration secrets.
const allowedGenericFixture = 'const source_id = record.source_id; const signature = audit.signature; const app_key = config.app_key;';
assert(!forbiddenIntegrations.some((rule) => rule.pattern.test(allowedGenericFixture)), 'L37 integration rules must allow generic source_id/signature/app_key fields');
const rejectedDadaFixture = 'const DADA_SOURCE_ID = value; fetch("https://newopen.imdada.cn/api/order");';
assert(forbiddenIntegrations.some((rule) => rule.pattern.test(rejectedDadaFixture)), 'L37 integration rules must reject provider-specific Dada integration');

const safetyFiles = ['apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/routes/public/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx'];
for (const f of safetyFiles) {
  const source = read(f).replaceAll('receiver_phone_masked','').replaceAll('pickup_store_phone','').replaceAll('receiver_address_masked','').replaceAll('delivery_fee_cents','');
  for (const word of ['cost_price_' + 'cents','commission_' + 'value','commission_' + 'type','stock_deduct_' + 'quantity','password_' + 'hash','private_' + 'key','before_' + 'snapshot','after_' + 'snapshot','raw user ' + 'profile']) assert(!source.includes(word), `${f} exposes ${word}`);
}
console.log('Compliance scan passed.');
console.log('L37 delivery rule config baseline verification passed.');
