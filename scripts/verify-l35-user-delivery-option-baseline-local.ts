import { assertStageRegistered } from './stage-verifier-registration.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
assertStageRegistered('L35', 'scripts/verify-l35-user-delivery-option-baseline-local.ts');
const root = process.cwd();
function read(p:string){return readFileSync(join(root,p),'utf8')}
function mustFile(p:string){ if(!existsSync(join(root,p))) throw new Error(`Missing file: ${p}`)}
function mustInclude(p:string, terms:string[]){const s=read(p); for(const t of terms) if(!s.includes(t)) throw new Error(`${p} missing ${t}`)}
function mustNotIncludePattern(p:string, patterns:Array<{ label:string; pattern:RegExp }>){const s=read(p); for(const item of patterns) if(item.pattern.test(s)) throw new Error(`${p} contains forbidden ${item.label}`)}
const compliance = spawnSync('pnpm',['exec','tsx','scripts/verify-no-raw-compliance-terms-local.ts'],{cwd:root,encoding:'utf8'});
process.stdout.write(compliance.stdout); process.stderr.write(compliance.stderr); if(compliance.status!==0) throw new Error('Compliance scan failed');
const files=['apps/api/src/modules/order/order-service.ts','apps/api/src/modules/user-orders/user-order-service.ts','apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/api/delivery.ts','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','scripts/verify-l35-user-delivery-option-baseline-local.ts','scripts/verify-all-local.sh','scripts/stage-workflow.ts','scripts/generate-stage-report.ts','docs/reviews/l35-user-delivery-option-baseline.md'];
files.forEach(mustFile);
mustInclude('apps/api/src/modules/order/order-service.ts',['pickup_type','delivery','store','receiver_address','receiver_phone_masked','pickup_store_id','pickupType === PickupType.delivery','配送地址必填校验','自提点必填校验','toPublicOrder']);
mustInclude('apps/miniapp/pages/orders/confirm/index.wxml',['到店自提','门店配送','pickup_type','receiver_name','receiver_phone','receiver_address','当前为门店配送','暂不接第三方配送','自提点','提交校验']);
mustInclude('apps/miniapp/pages/orders/detail/index.wxml',['到店自提','门店配送','配送地址','配送状态','自提码','自提点地址']);
mustInclude('apps/admin/src/pages/delivery/DeliveryReservationPage.tsx',['pickup_type','store_delivery','receiver_phone_masked','receiver_address_masked','门店配送','达达配送接口已预留','不会创建真实配送单']);
const realGateway = ['newopen','dada'].join('.');
const blocked = [
  { label: realGateway, pattern: new RegExp(realGateway.replace('.', '\\.'), 'i') },
  { label: 'app_'+'secret', pattern: /app_secret/i },
  { label: 'app_'+'key', pattern: /app_key/i },
  { label: 'source_'+'id', pattern: /(?<!credit_)source_id/i },
  { label: 'sign'+'ature', pattern: /\bsignature\b/i },
  { label: 'axios.post to delivery gateway', pattern: /axios\.post\([^)]*dada/i },
  { label: 'fetch to delivery gateway', pattern: /fetch\([^)]*dada/i },
  { label: 'request to delivery gateway', pattern: /request\([^)]*dada/i },
  { label: 'real delivery order', pattern: /real delivery order/i }
];
const deliveryIntegrationFiles = ['apps/api/src/modules/delivery/delivery-service.ts','apps/admin/src/pages/delivery/DeliveryReservationPage.tsx','apps/admin/src/api/delivery.ts','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/detail/index.js','docs/reviews/l35-user-delivery-option-baseline.md'];
for (const f of deliveryIntegrationFiles) mustNotIncludePattern(f, blocked);
console.log('Compliance scan passed.');
console.log('L35 user delivery option baseline verification passed.');
