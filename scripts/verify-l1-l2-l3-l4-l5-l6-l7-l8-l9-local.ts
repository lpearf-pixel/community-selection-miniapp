import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(path: string) {
  return readFileSync(path, 'utf8');
}

function runComplianceScan() {
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(result.status === 0, 'compliance scan should pass');
}

function assertAdminEnhancements() {
  const app = source('apps/admin/src/App.tsx');
  assert(app.includes("type ViewKey = 'products' | 'groupBuys' | 'orders' | 'withdrawals' | 'alerts' | 'taxRecords'"), 'admin should include L9 views');
  assert(app.includes('/api/admin/logs/orders/'), 'admin order detail should load AI context');
  assert(app.includes('/api/admin/withdrawals'), 'admin should load withdrawals');
  assert(app.includes('/api/admin/tax-records'), 'admin should load tax records');
  assert(app.includes('/api/admin/logs/alerts'), 'admin should load alerts');
  assert(app.includes("updateAlert(item, 'resolve')"), 'admin should resolve alerts');
  assert(app.includes("updateAlert(item, 'ignore')"), 'admin should ignore alerts');
  assert(app.includes('tax_mode') && app.includes('tax_status') && app.includes('payable_amount_cents') && app.includes('invoice_status'), 'withdrawal table should expose tax fields');
}

function assertBackendRoutes() {
  const withdrawalRoutes = source('apps/api/src/routes/withdrawals.ts');
  const logsRoutes = source('apps/api/src/routes/logs.ts');
  assert(withdrawalRoutes.includes('/api/admin/withdrawals/:id/tax-review'), 'tax review route should exist');
  assert(withdrawalRoutes.includes('/api/admin/tax-records'), 'tax records route should exist');
  assert(logsRoutes.includes('/api/admin/logs/orders/:order_id/ai-context'), 'AI context route should exist');
}

runComplianceScan();
assertAdminEnhancements();
assertBackendRoutes();
console.log('L1-L9 local verification passed. Full business flow is covered by the L8 verifier invoked by the L9 shell wrapper.');
