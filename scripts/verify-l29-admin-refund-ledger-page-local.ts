import { assertStageRegistered } from './stage-verifier-registration.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

assertStageRegistered('L29', 'scripts/verify-l29-admin-refund-ledger-page-local.ts');
const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

function runComplianceScan() {
  const output = execFileSync(process.execPath, ['scripts/verify-no-raw-compliance-terms-local.ts'], { cwd: repoRoot, encoding: 'utf8' });
  process.stdout.write(output);
  assert(output.includes('No raw compliance-sensitive terms found in verify/docs files.'), 'Compliance-sensitive wording scan did not report success');
}

function assertNoSensitiveFields(file: string, content: string) {
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/receiver_phone(?!_masked)/, 'receiver_phone'],
    [/cost_price_cents/, 'cost_price_cents'],
    [/commission_value/, 'commission_value'],
    [/commission_type/, 'commission_type'],
    [/stock_deduct_quantity/, 'stock_deduct_quantity'],
    [/password_hash/, 'password_hash'],
    [/private_key/, 'private_key'],
    [/before_snapshot/, 'before_snapshot'],
    [/after_snapshot/, 'after_snapshot']
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    assert(!pattern.test(content), `${file} must not expose ${label}`);
  }
}

async function main() {
  runComplianceScan();

  const pageFile = 'apps/admin/src/pages/finance/FinanceRefundLedgerPage.tsx';
  const apiFile = 'apps/admin/src/api/financeRefundLedger.ts';
  const appFile = 'apps/admin/src/App.tsx';
  const requiredFiles = [
    pageFile,
    apiFile,
    appFile,
    'scripts/verify-l29-admin-refund-ledger-page-local.ts',
    'docs/reviews/l29-admin-refund-ledger-page.md',
    'scripts/stage-workflow.ts',
    'scripts/verify-all-local.sh',
    'scripts/generate-stage-report.ts'
  ];
  for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `Missing required file: ${file}`);

  const page = read(pageFile);
  const api = read(apiFile);
  const app = read(appFile);
  const workflow = read('scripts/stage-workflow.ts');
  const verifyAll = read('scripts/verify-all-local.sh');
  const report = read('scripts/generate-stage-report.ts');
  const doc = read('docs/reviews/l29-admin-refund-ledger-page.md');

  [
    'refund-ledger', '退款台账', 'order_no', 'group_buy_id', 'refund_status', 'refund_method',
    'refund_amount_cents', 'receiver_phone_masked', 'refund_transaction_id', 'out_refund_no',
    'admin_remark', 'export.csv', 'page', 'page_size', 'total', 'summary'
  ].forEach((keyword) => assert(page.includes(keyword) || api.includes(keyword), `Missing Admin page keyword: ${keyword}`));

  ['/api/admin/finance/refund-ledger', '/api/admin/finance/refund-ledger/export.csv'].forEach((path) => {
    assert(api.includes(path), `API client must call ${path}`);
  });
  ['order_no', 'group_buy_id', 'status', 'refund_method', 'from', 'to', 'page', 'page_size'].forEach((param) => {
    assert(api.includes(param), `API client must support param ${param}`);
  });

  assert(app.includes('FinanceRefundLedgerPage') && app.includes('退款台账') && app.includes('refundLedger'), 'Admin route/menu must expose refund ledger page');
  assert(page.includes('暂无退款记录'), 'Empty state must show no refund records copy');
  assert(page.includes('loading') && page.includes('exporting'), 'Page must expose loading and exporting states');
  assert(page.includes('errorMessage') && page.includes('console.error'), 'Page must show request errors');

  assertNoSensitiveFields(pageFile, page);
  assertNoSensitiveFields(apiFile, api);

  assert(report.includes('l29Manifest') && report.includes('l29-admin-refund-ledger-page.md'), 'stage report manifest must include L29');
  ['退款台账', 'CSV 导出', 'receiver_phone_masked', '不调用真实微信退款 API', '无新增表', '无新增字段'].forEach((keyword) => assert(doc.includes(keyword), `Review doc missing keyword: ${keyword}`));

  console.log('Compliance scan passed.');
  console.log('L29 admin refund ledger page verification passed.');
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
