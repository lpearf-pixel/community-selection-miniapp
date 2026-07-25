import { assertStageRegistered } from './stage-verifier-registration.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAdminAccessContext } from '../apps/api/src/modules/admin-access/admin-access-control.ts';

assertStageRegistered('L31', 'scripts/verify-l31-admin-access-control-baseline-local.ts');
const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

function runComplianceScan() {
  const output = execFileSync('pnpm', ['exec', 'tsx', 'scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: repoRoot, encoding: 'utf8' });
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

  const previousNodeEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert(resolveAdminAccessContext({ adminUser: { id: 'formal-unknown', role: 'unknown_role' }, headers: {} } as any) === null, 'unknown formal role must be rejected');
    assert(resolveAdminAccessContext({ headers: {} } as any) === null, 'missing identity must be rejected');
    assert(resolveAdminAccessContext({ headers: { 'x-admin-role': 'super_admin', 'x-admin-user-id': 'forged-admin' } } as any) === null, 'production header-only super_admin must not authenticate');

    process.env.NODE_ENV = 'development';
    const devFinance = resolveAdminAccessContext({ headers: { 'x-admin-role': 'finance', 'x-admin-user-id': 'dev-finance' } } as any);
    assert(devFinance?.role === 'finance' && devFinance.data_scope_source === 'header_mock', 'development header mock finance must be usable');
    const formalFinance = resolveAdminAccessContext({ adminUser: { id: 'formal-finance', role: 'finance' }, headers: { 'x-admin-role': 'super_admin', 'x-admin-user-id': 'forged-admin' } } as any);
    assert(formalFinance?.role === 'finance' && formalFinance.data_scope_source === 'session' && !formalFinance.is_super_admin, 'formal finance session must not be elevated by headers');
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
  }
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
  assert(report.includes('l31Manifest') && report.includes('l31-admin-access-control-baseline.md'), 'stage report manifest must include L31');

  console.log('Compliance scan passed.');
  console.log('L31 admin access control baseline verification passed.');
}

main();
