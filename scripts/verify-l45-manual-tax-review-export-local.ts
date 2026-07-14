import { existsSync, readFileSync } from 'node:fs';
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const route = readFileSync('apps/api/src/routes/withdrawals.ts', 'utf8');
const page = readFileSync('apps/admin/src/pages/tax-review/TaxReviewPage.tsx', 'utf8');
const e2e = readFileSync('scripts/verify-docker-api-e2e-local.ts', 'utf8');
const report = readFileSync('scripts/generate-stage-report.ts', 'utf8');
const reportVerifier = readFileSync('scripts/verify-report-publish-local.ts', 'utf8');
assert(route.includes('/api/admin/tax-records/export.csv'), 'L45 CSV API exists');
assert(route.includes('requireAdminPermission("finance.view")'), 'finance.view is required');
assert(route.includes('requireAdminPermission("finance.export")'), 'finance.export is required');
assert(route.includes('requireAdminPermission("withdrawal.manage")'), 'withdrawal.manage is required');
assert(route.includes('withdrawalScopeWhere(context)'), 'database data scope is reused');
assert(route.includes('prisma.taxRecord.count({ where })') && route.includes('skip: (page - 1) * pageSize') && route.includes('take: pageSize'), 'database pagination exists');
assert(route.includes('csvSafe') && route.includes('/^[=+\\-@\\t\\r\\n]/'), 'CSV formula injection guard exists');
assert(route.includes('client_request_id') && route.includes('idempotent: true') && route.includes('409'), 'idempotency conflict handling exists');
assert(route.includes('taxAmount > taxableAmount') && route.includes('payableAmount < 0'), 'amount relation validation exists');
assert(page.includes('系统不会自动报税') && page.includes('系统不会连接外部税务平台') && page.includes('系统不会自动发起打款') && page.includes('仅供内部人工核对'), 'manual review disclaimers exist');
assert(existsSync('apps/admin/src/api/adminTaxReview.ts'), 'Admin API client exists');
for (const required of ['runL45TaxReviewScenario', 'await runL45TaxReviewScenario();', "POST', `/api/admin/withdrawals/${fixtureA.withdrawal.id}/tax-review`", 'Promise.allSettled', 'prisma.withdrawal', 'prisma.taxRecord', 'prisma.adminAuditLog', 'prisma.businessEventLog', 'financeAHeaders', 'financeBHeaders', 'negative taxable', 'rejected tax review must not mutate Withdrawal', '=HYPERLINK', '+SUM(1,1)', '@cmd', '-1+2']) {
  assert(e2e.includes(required), `L45 Docker E2E must include ${required}`);
}
assert(report.includes('const isL45Stage') && report.includes('l45Manifest') && report.includes('stable/l44-business-base') && report.includes('3ae666ec0e26383a5b117b64dce30b86a2dee389'), 'L45 report manifest exists');
assert(reportVerifier.includes('L45 report changed files') && reportVerifier.includes('Report publish verification passed.') && reportVerifier.includes('L45 report verification row must pass'), 'L45 report verifier exists');
assert(!route.includes('AUTO_TAX_FILING_ENABLED=true') && !route.includes('AUTO_PAYOUT_ENABLED=true'), 'no automatic tax/payout flag enabled');
assert(existsSync('docs/dev/stage-verifier-compatibility.md'), 'global verifier compatibility guidance exists');
for (const readinessMarker of ['waitForApiReady', "'/api/health'", 'fetchWithTimeout', 'fetchOrThrow', 'Docker API E2E target:', 'docker compose logs --tail=200 api']) {
  assert(e2e.includes(readinessMarker), `Docker E2E readiness/diagnostics must include ${readinessMarker}`);
}
assert(!existsSync('apps/admin/src/pages/dashboard-v2'), 'L46 dashboard not added');
console.log('L45 manual tax review export verifier passed.');
