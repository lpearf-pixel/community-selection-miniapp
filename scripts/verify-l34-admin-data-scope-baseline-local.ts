import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
function read(p: string) { assert(existsSync(p), `${p} should exist`); return readFileSync(p, 'utf8'); }
function includesAll(s: string, needles: string[], label: string) { for (const n of needles) assert(s.includes(n), `${label} missing ${n}`); }
function excludesAll(s: string, needles: string[], label: string) { for (const n of needles) assert(!s.includes(n), `${label} should not include ${n}`); }
const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: process.cwd(), encoding: 'utf8' });
process.stdout.write(compliance.stdout ?? ''); process.stderr.write(compliance.stderr ?? ''); assert(compliance.status === 0, 'Compliance scan failed');
const files = ['apps/api/src/modules/admin-access/admin-access-control.ts','apps/api/src/routes/admin/pickup.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','scripts/verify-l34-admin-data-scope-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l34-admin-data-scope-baseline.md'];
files.forEach((f) => assert(existsSync(f), `${f} should exist`));
const access = read('apps/api/src/modules/admin-access/admin-access-control.ts');
includesAll(access, ['AdminDataScope','data_scope','pickup_store_ids','community_ids','can_access_all_pickup_stores','can_access_all_communities','x-admin-pickup-store-id','x-admin-pickup-store-ids','x-admin-community-id','x-admin-community-ids','ADMIN_SCOPE_FORBIDDEN','Data scope denied','super_admin','clerk 不默认全量','store_manager 不默认全量'], 'access control');
const pickup = read('apps/api/src/routes/admin/pickup.ts');
includesAll(pickup, ["requireAdminPermission('pickup.verify')",'data_scope','pickup_store_id','by-code scope 检查','verify scope 检查','summary scope 过滤'], 'pickup route');
const delivery = read('apps/api/src/routes/admin/delivery.ts') + read('apps/api/src/modules/delivery/delivery-service.ts');
includesAll(delivery, ['requireAdminPermission','scope 检查','pickup_store_id 过滤','community_id 过滤','detail scope 检查','reserve scope 检查','status scope 检查'], 'delivery route/service');
const frontend = read('apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx') + read('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx') + read('apps/admin/src/access/adminAccess.ts');
includesAll(frontend, ['当前数据范围','未配置自提点/社区范围','ADMIN_PICKUP_STORE_ID','ADMIN_COMMUNITY_ID','x-admin-pickup-store-id','x-admin-community-id'], 'frontend');
for (const file of ['apps/api/src/routes/admin/pickup.ts','apps/api/src/routes/admin/delivery.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/access/adminAccess.ts']) {
  const src = read(file).replaceAll('receiver_phone_masked','').replaceAll('pickup_store_phone','').replaceAll('receiver_address_masked','').replaceAll('delivery_fee_cents','');
  excludesAll(src, ['receiver_' + 'phone','cost_' + 'price_cents','commission_' + 'value','commission_' + 'type','stock_' + 'deduct_quantity','password_' + 'hash','private_' + 'key','before_' + 'snapshot','after_' + 'snapshot','raw user ' + 'profile'], file);
}
console.log('Compliance scan passed.');
console.log('L34 admin data scope baseline verification passed.');
