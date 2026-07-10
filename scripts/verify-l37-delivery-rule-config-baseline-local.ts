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
const changed = files.filter((f) => !f.includes('verify-l37') && f !== 'prisma/schema.prisma').map(read).join('\n').replaceAll('credit_source_id', '');
const blocked = ['https://newopen.im' + 'dada' + 'abc.com','app_' + 'secret','app_' + 'key','source_' + 'id','sign' + 'ature','axios.post','fetch 到' + '达达','request 到' + '达达','real delivery ' + 'order'];
for (const word of blocked) assert(!changed.includes(word), `forbidden integration marker: ${word}`);
const safetyFiles = ['apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/routes/public/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryRuleConfigPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx'];
for (const f of safetyFiles) {
  const source = read(f).replaceAll('receiver_phone_masked','').replaceAll('pickup_store_phone','').replaceAll('receiver_address_masked','').replaceAll('delivery_fee_cents','');
  for (const word of ['cost_price_' + 'cents','commission_' + 'value','commission_' + 'type','stock_deduct_' + 'quantity','password_' + 'hash','private_' + 'key','before_' + 'snapshot','after_' + 'snapshot','raw user ' + 'profile']) assert(!source.includes(word), `${f} exposes ${word}`);
}
console.log('Compliance scan passed.');
console.log('L37 delivery rule config baseline verification passed.');
