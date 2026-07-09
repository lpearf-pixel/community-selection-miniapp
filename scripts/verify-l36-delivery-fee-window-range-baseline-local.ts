import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = process.cwd();
function read(p:string){return readFileSync(join(root,p),'utf8')}
function mustFile(p:string){ if(!existsSync(join(root,p))) throw new Error(`Missing file: ${p}`)}
function mustInclude(p:string, terms:string[]){const s=read(p); for(const t of terms) if(!s.includes(t)) throw new Error(`${p} missing ${t}`)}
function mustNot(p:string, patterns:Array<[string,RegExp]>){const s=read(p); for(const [label,pattern] of patterns) if(pattern.test(s)) throw new Error(`${p} contains forbidden ${label}`)}
const compliance = spawnSync('pnpm',['exec','tsx','scripts/verify-no-raw-compliance-terms-local.ts'],{cwd:root,encoding:'utf8'});
process.stdout.write(compliance.stdout); process.stderr.write(compliance.stderr); if(compliance.status!==0) throw new Error('Compliance scan failed');
const files=['apps/api/src/modules/delivery/delivery-rule-service.ts','apps/api/src/modules/order/order-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/admin/src/api/delivery.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l36-delivery-fee-window-range-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l36-delivery-fee-window-range-baseline.md'];
files.forEach(mustFile);
mustInclude('apps/api/src/modules/delivery/delivery-rule-service.ts',['getDeliveryRule','validateDeliveryRuleForOrder','base_fee_cents','free_threshold_cents','service_radius_text','available_time_windows','delivery_time_window_code','当前为门店配送','暂不接第三方配送']);
mustInclude('apps/api/src/routes/public/delivery.ts',['/api/delivery/rules']);
mustInclude('apps/api/src/routes/admin/delivery.ts',['/api/admin/delivery/rules','requireAdminPermission','order.view','pickup.verify']);
mustInclude('apps/api/src/modules/order/order-service.ts',["pickupType === PickupType.delivery",'delivery_time_window_code','receiver_address','receiver_phone_masked','配送时段','delivery_fee_cents','不调用达达','不调用第三方配送']);
mustInclude('apps/miniapp/pages/orders/confirm/index.wxml',['到店自提','门店配送','配送范围','配送费','配送时段','delivery_time_window_code','receiver_name','receiver_phone','receiver_address','当前为门店配送','暂不接第三方配送']);
mustInclude('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',['配送规则','静态 baseline','配送范围','配送时段','配送费','达达接口未启用']);
const sourceIdNearDada = new RegExp('dada[\\s\\S]{0,120}source' + '_id|source' + '_id[\\s\\S]{0,120}dada', 'i');
const appSecretPattern = new RegExp('app' + '[_-]?' + 'secret', 'i');
const appKeyPattern = new RegExp('app' + '[_-]?' + 'key', 'i');
const thirdPartyGatewayForbidden:Array<[string,RegExp]> = [
  ['real dada gateway', /newopen\.imdada\.cn|api\.imdada\.cn/i],
  ['app secret', appSecretPattern],
  ['app key', appKeyPattern],
  ['dada source id', sourceIdNearDada],
  ['sign'+'ature', /\bsignature\b/i],
  ['axios post to delivery gateway', /axios\.post[\s\S]{0,120}(dada|imdada)/i],
  ['fetch to delivery gateway', /fetch\([\s\S]{0,120}(dada|imdada)/i],
  ['request to delivery gateway', /request\([\s\S]{0,120}(dada|imdada)/i],
  ['real delivery order', /create\s+real\s+delivery\s+order/i]
];
['apps/api/src/modules/delivery/dada-adapter.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/api/src/routes/admin/delivery.ts'].forEach((file)=>mustNot(file, thirdPartyGatewayForbidden));
console.log('Compliance scan passed.');
console.log('L36 delivery fee window range baseline verification passed.');
