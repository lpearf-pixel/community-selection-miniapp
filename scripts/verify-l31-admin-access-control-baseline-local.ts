import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

function runComplianceScan() {
  const output = execFileSync(process.execPath, ['scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: repoRoot, encoding: 'utf8' });
  process.stdout.write(output);
  assert(output.includes('No raw compliance-sensitive terms found in verify/docs files.'), 'Compliance-sensitive wording scan did not report success');
}

function assertNoSensitiveOutput(file: string, content: string) {
  const forbidden = ['cost_price_cents', 'commission_value', 'commission_type', 'stock_deduct_quantity', 'password_hash', 'private_key', 'before_snapshot', 'after_snapshot'];
  for (const term of forbidden) assert(!content.includes(term), `${file} must not expose ${term}`);
  const rawPhoneOutput = /receiver_phone\s*:/g.test(content.replace(/receiver_phone\?:/g, '').replace(/receiver_phone_masked/g, ''));
  assert(!rawPhoneOutput, `${file} must not output raw receiver phone`);
}

function main() {
  runComplianceScan();

  const accessFile = 'apps/api/src/modules/admin-access/admin-access-control.ts';
  const financeFile = 'apps/api/src/routes/admin/finance.ts';
  const operationsFile = 'apps/api/src/routes/admin/operations.ts';
  const groupBuyFile = 'apps/api/src/routes/group-buys.ts';
  const requiredFiles = [
    accessFile,
    financeFile,
    operationsFile,
    groupBuyFile,
    'scripts/verify-l31-admin-access-control-baseline-local.ts',
    'scripts/verify-all-local.sh',
    'scripts/stage-workflow.ts',
    'scripts/generate-stage-report.ts',
    'docs/reviews/l31-admin-access-control-baseline.md'
  ];
  for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `Missing required file: ${file}`);

  const access = read(accessFile);
  const finance = read(financeFile);
  const operations = read(operationsFile);
  const groupBuy = read(groupBuyFile);
  const workflow = read('scripts/stage-workflow.ts');
  const verifyAll = read('scripts/verify-all-local.sh');
  const report = read('scripts/generate-stage-report.ts');
  const doc = read('docs/reviews/l31-admin-access-control-baseline.md');

  [
    'AdminRole','AdminPermission','ROLE_PERMISSIONS','resolveAdminAccessContext','hasAdminPermission','requireAdminPermission',
    'admin.full_access','finance.view','finance.export','refund.view','refund.manage','risk.view','pickup.verify',
    'operations.view','product.manage','order.view','order.manage','after_sale.manage','staff.manage','system.manage',
    'x-admin-role','x-admin-user-id','ADMIN_FORBIDDEN','Permission denied'
  ].forEach((keyword) => assert(access.includes(keyword), `Missing backend access keyword: ${keyword}`));

  ['unknown role rejected', 'no default super_admin', 'production does not trust x-admin-role'].forEach((keyword) => assert(access.includes(keyword), `Missing access safety comment/semantic: ${keyword}`));
  assert(doc.includes('前端菜单只做体验') && doc.includes('后端权限校验是安全边界'), 'frontend permission is not security boundary must be documented');

  const financeRoutes = ['refund-ledger', 'refund-ledger/export.csv', 'refund-risk/overview', 'refund-risk/items', 'refund-risk/export.csv'];
  for (const route of financeRoutes) {
    const index = finance.indexOf(route);
    assert(index >= 0, `Missing finance route: ${route}`);
    assert(finance.slice(Math.max(0, index - 160), index + 220).includes('requireAdminPermission'), `Finance route ${route} must use requireAdminPermission`);
  }
  ['finance.view','finance.export','refund.view','risk.view'].forEach((permission) => assert(finance.includes(permission), `Finance route missing permission ${permission}`));
  ['expired-pending','mark-failed','manual-refund-orders','close-unpaid-orders','manual-refund'].forEach((route) => assert(groupBuy.includes(route) && groupBuy.includes('requireAdminPermission'), `Group buy/manual route guard missing for ${route}`));
  assert(operations.includes('requireAdminPermission') && operations.includes('operations.view'), 'operations routes must use operations.view guard');

  [accessFile, financeFile, operationsFile, groupBuyFile].forEach((file) => assertNoSensitiveOutput(file, read(file)));
  assert(workflow.includes('L31') && workflow.includes('verify-l31-admin-access-control-baseline-local.ts'), 'stage workflow must register L31');
  assert(workflow.includes("'L31', 'L30', 'L29', 'L28', 'L27', 'L26', 'L25', 'L24'"), 'L31 regression chain must include L31..L24');
  assert(verifyAll.includes('verify-l31-admin-access-control-baseline-local.ts'), 'verify-all must include L31 verifier');
  assert(report.includes('l31Manifest') && report.includes('l31-admin-access-control-baseline.md'), 'stage report manifest must include L31');

  console.log('Compliance scan passed.');
  console.log('L31 admin access control baseline verification passed.');
}

main();
