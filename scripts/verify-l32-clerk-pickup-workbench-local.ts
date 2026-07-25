import { assertStageRegistered } from './stage-verifier-registration.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

assertStageRegistered('L32', 'scripts/verify-l32-clerk-pickup-workbench-local.ts');
const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

function runComplianceScan() {
  const output = execFileSync('pnpm', ['exec', 'tsx', 'scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: repoRoot, encoding: 'utf8' });
  process.stdout.write(output);
  assert(output.includes('No raw compliance-sensitive terms found in verify/docs files.'), 'Compliance wording scan did not report success');
}

function assertNoSensitiveOutput(file: string, content: string) {
  const forbidden = ['pay_amount_cents','total_amount_cents','refund_amount_cents','cost_price_cents','commission_value','commission_type','stock_deduct_quantity','password_hash','private_key','before_snapshot','after_snapshot'];
  for (const term of forbidden) assert(!content.includes(term), `${file} must not expose ${term}`);
  const withoutAllowed = content.replace(/receiver_phone_masked/g, '').replace(/pickup_store_phone/g, '').replace(/'receiver' \+ '_phone'/g, '');
  assert(!/receiver_phone\s*[:?]/.test(withoutAllowed), `${file} must not expose raw receiver phone`);
}

function main() {
  runComplianceScan();
  const files = [
    'apps/api/src/routes/admin/pickup.ts',
    'apps/api/src/routes/admin/orders.ts',
    'apps/api/src/modules/order/admin-pickup-verification-executor.ts',
    'apps/api/src/modules/admin-access/admin-access-control.ts',
    'apps/admin/src/api/pickupWorkbench.ts',
    'apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx',
    'apps/admin/src/app/AdminApp.tsx',
    'apps/admin/src/app/feature-registry.ts',
    'scripts/verify-l32-clerk-pickup-workbench-local.ts',
    'scripts/verify-all-local.sh',
    'scripts/stage-workflow.ts',
    'scripts/generate-stage-report.ts',
    'docs/reviews/l32-clerk-pickup-workbench.md'
  ];
  for (const file of files) assert(existsSync(join(repoRoot, file)), `Missing required file: ${file}`);

  const pickup = read('apps/api/src/routes/admin/pickup.ts');
  const pickupVerification = read('apps/api/src/routes/admin/orders.ts')
    + read('apps/api/src/modules/order/admin-pickup-verification-executor.ts');
  const api = read('apps/admin/src/api/pickupWorkbench.ts');
  const page = read('apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx');
  const app = read('apps/admin/src/app/AdminApp.tsx');
  const featureRegistry = read('apps/admin/src/app/feature-registry.ts');
  const workflow = read('scripts/stage-workflow.ts');
  const verifyAll = read('scripts/verify-all-local.sh');
  const report = read('scripts/generate-stage-report.ts');

  ['/api/admin/pickup/orders','/api/admin/pickup/orders/by-code/:code','/api/admin/pickup/summary','requireAdminPermission','pickup.verify','receiver_phone_masked','pickup_code'].forEach((needle) => assert(pickup.includes(needle), `Missing backend read route keyword: ${needle}`));
  ['订单未支付，不能核销','verifyDoneStatuses','safePickupOrder'].forEach((needle) => assert(pickup.includes(needle), `Missing backend read semantic: ${needle}`));
  assert(!pickup.includes("app.post('/api/admin/pickup/orders/:id/verify'"), 'legacy pickup workbench must not retain a write route');
  ['/api/admin/orders/:id/pickup-verify',"requireAdminPermissionV1('pickup.verify')",'executeAdminPickupVerificationCommand','canAccessOrderDataScope','assertOrderScope','ADMIN_FORBIDDEN','OrderStatus.picked'].forEach((needle) => assert(pickupVerification.includes(needle), `Missing reliable pickup verification semantic: ${needle}`));

  ['PickupWorkbenchPage','自提工作台','pickup.verify','自提码','订单号','receiver_phone_masked','核销','暂无待自提订单','无权限访问','loading'].forEach((needle) => assert(page.includes(needle), `Missing frontend page keyword: ${needle}`));
  ['/api/admin/pickup/orders','/api/admin/pickup/orders/by-code','/api/admin/orders/${orderId}/pickup-verify','/api/admin/pickup/summary'].forEach((needle) => assert(api.includes(needle), `Missing frontend API call: ${needle}`));
  assert(app.includes('PickupWorkbenchPage') && app.includes('pickupWorkbench') && featureRegistry.includes("label: '自提工作台'"), 'App must register pickup workbench page/menu');

  ['apps/api/src/routes/admin/pickup.ts','apps/admin/src/api/pickupWorkbench.ts','apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx'].forEach((file) => assertNoSensitiveOutput(file, read(file)));
  assert(report.includes('l32Manifest') && report.includes('l32-clerk-pickup-workbench.md'), 'stage report manifest must include L32');

  console.log('Compliance scan passed.');
  console.log('L32 clerk pickup workbench verification passed.');
}

main();
