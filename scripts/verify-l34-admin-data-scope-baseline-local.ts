import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAdminDataScope } from '../apps/api/src/modules/admin-access/admin-access-control.ts';

assertStageRegistered('L34', 'scripts/verify-l34-admin-data-scope-baseline-local.ts');
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string) {
  assert(existsSync(path), `${path} should exist`);
  return readFileSync(path, 'utf8');
}

function includesAll(source: string, needles: string[], label: string) {
  for (const needle of needles) assert(source.includes(needle), `${label} missing ${needle}`);
}

function excludesAll(source: string, needles: string[], label: string) {
  for (const needle of needles) assert(!source.includes(needle), `${label} should not include ${needle}`);
}

function walk(dir: string, predicate: (file: string) => boolean, result: string[] = []) {
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    if (new Set(['node_modules', 'reports', '.git', '.tmp']).has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) walk(fullPath, predicate, result);
    else if (predicate(fullPath)) result.push(fullPath);
  }
  return result;
}

function verifyNoRawComplianceTerms() {
  const repoRoot = process.cwd();
  const forbiddenTerms = [
    '优' + '惠券',
    '裂' + '变',
    '会' + '员',
    '多级' + '分销',
    '团队' + '收益',
    '代理' + '收益',
    '下' + '线',
    '上' + '级',
    '下' + '级',
    '邀请' + '返利',
    '拉人' + '赚钱',
    'AUTO_PAYOUT_ENABLED = ' + 'true',
    'AUTO_TAX_FILING_ENABLED = ' + 'true'
  ];
  const files = [
    ...walk(join(repoRoot, 'scripts'), (file) => /\/verify-[^/]+\.ts$/.test(file) && !file.endsWith('/lib/compliance-scan.ts')),
    ...walk(join(repoRoot, 'docs', 'reviews'), (file) => file.endsWith('.md')),
    join(repoRoot, 'scripts', 'generate-stage-report.ts')
  ].filter((file, index, all) => all.indexOf(file) === index && existsSync(file));
  const violations: Array<{ file: string; term: string }> = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const term of forbiddenTerms) if (content.includes(term)) violations.push({ file, term });
  }
  if (violations.length > 0) {
    for (const violation of violations) console.error(`${violation.file.replace(`${repoRoot}/`, '')}: raw compliance-sensitive term found: ${violation.term}`);
    process.exit(1);
  }
  console.log('No raw compliance-sensitive terms found in verify/docs files.');
}

verifyNoRawComplianceTerms();

const files = [
  'apps/api/src/modules/admin-access/admin-access-control.ts',
  'apps/api/src/routes/admin/pickup.ts',
  'apps/api/src/routes/admin/orders.ts',
  'apps/api/src/modules/order/admin-pickup-verification-executor.ts',
  'apps/api/src/routes/admin/delivery.ts',
  'apps/api/src/modules/delivery/delivery-service.ts',
  'apps/api/src/modules/delivery/admin-delivery-status-executor.ts',
  'apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx',
  'apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',
  'scripts/verify-l34-admin-data-scope-baseline-local.ts',
  'scripts/verify-all-local.sh',
  'scripts/stage-workflow.ts',
  'scripts/generate-stage-report.ts',
  'docs/reviews/l34-admin-data-scope-baseline.md'
];
files.forEach((file) => assert(existsSync(file), `${file} should exist`));

const access = read('apps/api/src/modules/admin-access/admin-access-control.ts');
includesAll(access, ['AdminDataScope','data_scope','pickup_store_ids','community_ids','can_access_all_pickup_stores','can_access_all_communities','x-admin-pickup-store-id','x-admin-pickup-store-ids','x-admin-community-id','x-admin-community-ids','ADMIN_SCOPE_FORBIDDEN','Data scope denied','super_admin'], 'access control');
const fullScope = resolveAdminDataScope({ headers: {} } as any, 'super_admin', 'session');
assert(fullScope.can_access_all_pickup_stores && fullScope.can_access_all_communities, 'super_admin session must have full data scope');
for (const role of ['clerk', 'store_manager', 'finance', 'operator'] as const) {
  const scope = resolveAdminDataScope({ headers: { 'x-admin-pickup-store-ids': 'ps-forged', 'x-admin-community-ids': 'c-forged' } } as any, role, 'session');
  assert(!scope.can_access_all_pickup_stores && !scope.can_access_all_communities && scope.pickup_store_ids.length === 0 && scope.community_ids.length === 0, `${role} session must fail closed without persisted scope`);
}
const headerScope = resolveAdminDataScope({ headers: { 'x-admin-pickup-store-id': 'ps-1', 'x-admin-pickup-store-ids': 'ps-1,ps-2', 'x-admin-community-id': 'c-1', 'x-admin-community-ids': 'c-1,c-2' } } as any, 'finance', 'header_mock');
assert(JSON.stringify(headerScope.pickup_store_ids) === JSON.stringify(['ps-1', 'ps-2']) && JSON.stringify(headerScope.community_ids) === JSON.stringify(['c-1', 'c-2']), 'header_mock scope must include explicit de-duplicated ids');
assert(!headerScope.can_access_all_pickup_stores && !headerScope.can_access_all_communities, 'header_mock scope must not become full access automatically');

const pickup = read('apps/api/src/routes/admin/pickup.ts');
includesAll(pickup, ["requireAdminPermission('pickup.verify')",'data_scope','pickup_store_id','by-code scope 检查','summary scope 过滤'], 'pickup read route');
const pickupVerification = read('apps/api/src/routes/admin/orders.ts')
  + read('apps/api/src/modules/order/admin-pickup-verification-executor.ts');
includesAll(pickupVerification, ["requireAdminPermissionV1('pickup.verify')",'resolveAdminAccessContext','canAccessOrderDataScope','assertOrderScope','ADMIN_FORBIDDEN','replayReceipt'], 'pickup verification command');

const delivery = read('apps/api/src/routes/admin/delivery.ts') + read('apps/api/src/modules/delivery/delivery-service.ts');
includesAll(delivery, ['requireAdminPermission','scope 检查','pickup_store_id 过滤','community_id 过滤','detail scope 检查','reserve scope 检查'], 'delivery route/service');
const deliveryStatusCommand = read('apps/api/src/routes/admin/delivery.ts')
  + read('apps/api/src/modules/delivery/admin-delivery-status-executor.ts');
includesAll(deliveryStatusCommand, ['requireAdminPermissionV1','resolveAdminAccessContext','executeAdminDeliveryStatusCommand','canAccessOrderDataScope','assertScope','ADMIN_DELIVERY_SCOPE_FORBIDDEN','replayReceipt'], 'delivery status command');

const frontend = read('apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx') + read('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx') + read('apps/admin/src/access/adminAccess.ts');
includesAll(frontend, ['当前数据范围','未配置自提点/社区范围','ADMIN_PICKUP_STORE_ID','ADMIN_COMMUNITY_ID','x-admin-pickup-store-id','x-admin-community-id'], 'frontend');

for (const file of ['apps/api/src/routes/admin/pickup.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/access/adminAccess.ts']) {
  const source = read(file).replaceAll('receiver_phone_masked','').replaceAll('pickup_store_phone','').replaceAll('receiver_address_masked','').replaceAll('delivery_fee_cents','');
  excludesAll(source, ['receiver_' + 'phone','cost_' + 'price_cents','commission_' + 'value','commission_' + 'type','stock_' + 'deduct_quantity','password_' + 'hash','private_' + 'key','before_' + 'snapshot','after_' + 'snapshot','raw user ' + 'profile'], file);
}

console.log('Compliance scan passed.');
console.log('L34 admin data scope baseline verification passed.');
