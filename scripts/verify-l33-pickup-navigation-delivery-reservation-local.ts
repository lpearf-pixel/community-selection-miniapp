import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

assertStageRegistered('L33', 'scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts');
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { assert(existsSync(path), `${path} should exist`); return readFileSync(path, 'utf8'); }
function includesAll(source: string, needles: string[], label: string) { for (const needle of needles) assert(source.includes(needle), `${label} missing ${needle}`); }
function excludesAll(source: string, needles: string[], label: string) { for (const needle of needles) assert(!source.includes(needle), `${label} should not include ${needle}`); }

const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: process.cwd(), encoding: 'utf8' });
process.stdout.write(compliance.stdout ?? '');
process.stderr.write(compliance.stderr ?? '');
assert(compliance.status === 0, 'Compliance scan failed');

const files = ['apps/api/src/modules/locations/navigation-url.ts','apps/api/src/modules/delivery/delivery-types.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/api/src/modules/delivery/dada-adapter.ts','apps/api/src/routes/admin/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','scripts/verify-l33-pickup-navigation-delivery-reservation-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l33-pickup-navigation-delivery-reservation.md'];
files.forEach((file) => assert(existsSync(file), `${file} should exist`));

const navigation = read('apps/api/src/modules/locations/navigation-url.ts') + read('apps/api/src/modules/user-locations/user-location-service.ts') + read('apps/api/src/routes/admin/pickup.ts');
includesAll(navigation, ['buildAmapSearchUrl','uri.amap.com/search','callnative=1','navigation_url','navigation_address'], 'navigation');
excludesAll(navigation, ['map SDK import','map ' + 'tile','tile ' + 'server','route ' + 'planning','user location ' + 'tracking','coordinate ' + 'transform','POI ' + 'database'], 'navigation');

const delivery = read('apps/api/src/modules/delivery/delivery-types.ts') + read('apps/api/src/modules/delivery/delivery-service.ts') + read('apps/api/src/modules/delivery/dada-adapter.ts');
includesAll(delivery, ['DeliveryProvider','DeliveryStatus','DeliveryReservation','self','dada','manual','pending_dispatch','assigned','delivering','delivered','delivery_failed','canceled','third_party_order_no','createDadaDeliveryOrderMock','Dada delivery API is reserved but not enabled'], 'delivery');

const route = read('apps/api/src/routes/admin/delivery.ts');
includesAll(route, ['/api/admin/delivery/orders','/api/admin/delivery/orders/:id','/api/admin/delivery/orders/:id/reserve','/api/admin/delivery/orders/:id/status','/api/admin/delivery/providers','requireAdminPermission','order.view','order.manage'], 'admin delivery route');

const forbidden = ['https://newopen.im' + 'dada' + 'abc.com','app_' + 'secret','app_' + 'key','source_' + 'id','sign' + 'ature','axios.post','fetch(','request(','create real delivery ' + 'order','enabled: true, mode: \'reserved\''];
excludesAll(delivery + route, forbidden, 'third-party reserved boundary');

const safetyFiles = ['apps/api/src/modules/delivery/delivery-types.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/api/src/modules/delivery/dada-adapter.ts','apps/api/src/routes/admin/delivery.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx'];
for (const file of safetyFiles) {
  const source = read(file).replaceAll('receiver_phone_masked', '').replaceAll('pickup_store_phone', '').replaceAll('delivery_fee_cents', '').replaceAll('receiver_address_masked', '');
  excludesAll(source, ['receiver_' + 'phone','cost_' + 'price_cents','commission_' + 'value','commission_' + 'type','stock_' + 'deduct_quantity','password_' + 'hash','private_' + 'key','before_' + 'snapshot','after_' + 'snapshot','raw user ' + 'profile'], file);
}

const frontend = read('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx') + read('apps/admin/src/api/delivery.ts') + read('apps/admin/src/App.tsx');
includesAll(frontend, ['DeliveryReservationPage','配送预留','达达配送','接口已预留','不会创建真实配送单','receiver_phone_masked','receiver_address_masked','/api/admin/delivery/orders','/api/admin/delivery/providers'], 'frontend');

console.log('Compliance scan passed.');
console.log('L33 pickup navigation delivery reservation verification passed.');
