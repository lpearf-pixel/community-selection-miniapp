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
assert(route.includes('parseTaxReviewClientRequestId') && route.includes('review_requests') && route.includes('TAX_REVIEW_IDEMPOTENCY_LIMIT') && route.includes('idempotent: true') && route.includes('409'), 'complete tax review idempotency history exists');
assert(route.includes('function jsonValuesEqual(') && route.includes('Object.keys(leftRecord).sort()') && route.includes('jsonValuesEqual(previous.snapshot, requested)'), 'tax review idempotency must compare persisted JSON by semantic value');
assert(!route.includes('JSON.stringify(previous) !== JSON.stringify(requested)'), 'tax review idempotency must not depend on JSON object key order');
assert(e2e.includes('const reorderedReviewPayload = {') && e2e.includes('semantically identical payload must be idempotent regardless of JSON key order'), 'L45 E2E must verify idempotency after JSON round-trip and key reordering');
assert(e2e.includes('concurrentAppliedCount === 1') && e2e.includes('concurrentIdempotentCount === 1'), 'L45 E2E must prove exactly one applied and one idempotent result for concurrent same-key requests');
assert(e2e.includes('l45_concurrent_success_count=${concurrentFulfilled.length}') && e2e.includes('l45_concurrent_applied_count=${concurrentAppliedCount}') && e2e.includes('l45_concurrent_idempotent_count=${concurrentIdempotentCount}'), 'L45 E2E must publish exact current concurrency runtime markers');
assert(report.includes('l45_concurrent_success_count=2') && report.includes('l45_concurrent_applied_count=1') && report.includes('l45_concurrent_idempotent_count=1'), 'L45 report generator must consume the current same-key concurrency evidence');
assert(e2e.includes('new Uint8Array(await csvResponse.arrayBuffer())') && e2e.includes('csvBytes[0] === 0xef') && e2e.includes('csvBytes[1] === 0xbb') && e2e.includes('csvBytes[2] === 0xbf'), 'L45 CSV BOM must be verified from raw response bytes');
assert(e2e.includes('type TaxRecordPage = { items:') && e2e.includes('taxRecordsA.items') && e2e.includes('taxRecordsB.items'), 'L45 must keep the L44 tax-record consumer aligned with the paginated response contract');
assert(e2e.includes('const l44PaidTaxVersion = await prisma.withdrawal.findUniqueOrThrow') && e2e.includes('`${runId}-l44-tax-none`') && e2e.includes('expected_updated_at: l44PaidTaxVersion.updated_at.toISOString()'), 'L45 must keep the L44 tax-review compatibility call aligned with required idempotency and version fields');
assert(!e2e.includes("taxRecordsA.some(") && !e2e.includes("taxRecordsB.some("), 'L45 must not leave raw-array assumptions in the L44 regression scenario');
assert(e2e.includes("new TextDecoder('utf-8').decode(csvBytes.subarray(hasUtf8Bom ? 3 : 0))"), 'L45 CSV body must be decoded after raw BOM verification');
assert(!e2e.includes("csv.charCodeAt(0) === 0xfeff"), 'L45 CSV verifier must not expect Response.text() to preserve BOM');
assert(route.includes('taxAmount > taxableAmount') && route.includes('payableAmount < 0'), 'amount relation validation exists');
const adminClient = readFileSync('apps/admin/src/api/adminTaxReview.ts', 'utf8');
assert(adminClient.includes('downloadTaxReviewCsv') && adminClient.includes('adminFetch') && adminClient.includes('URL.createObjectURL') && adminClient.includes('content-disposition'), 'Admin CSV export must use authenticated blob fetch');
assert(!page.includes('href={taxReviewExportUrl('), 'TaxReviewPage must not use href CSV downloads');
assert(route.includes('TAX_EXPORT_LIMIT') && route.includes('x-export-total') && route.includes('x-export-truncated') && route.includes('422'), 'CSV export must reject over-limit rather than truncate silently');
assert(route.includes('expected_updated_at') && route.includes('updated_at: w?.updated_at') && route.includes('where: { id, updated_at: expectedUpdatedAt }'), 'tax review must enforce client-side optimistic concurrency');
assert(route.includes('const TAX_MODES') && route.includes('const TAX_STATUSES') && route.includes('const INVOICE_STATUSES') && route.includes('validateTaxCombination'), 'tax status allow-lists and combination validation must exist');
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
assert(!e2e.includes('await fetch(`${API_BASE_URL}'), 'Docker E2E API calls must go through fetchOrThrow for diagnostics');
assert(e2e.includes("const runId = `l45-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`"), 'L45 E2E run token must be unique across reruns and concurrent processes');
const dangerousClientFixtureLine = e2e.split(/\r?\n/).find((line) => line.includes("suffix === 'danger-a'") && line.includes('client_request_id'));
assert(dangerousClientFixtureLine, 'L45 dangerous client_request_id fixture line must exist');
assert(dangerousClientFixtureLine.includes('client-danger-${runId}'), 'L45 dangerous unique client_request_id fixture must include the run token');
assert(dangerousClientFixtureLine.includes(String.raw`\tclient-danger-`), 'L45 dangerous client_request_id fixture must preserve the escaped tab prefix');
assert(!e2e.includes(String.raw`suffix === 'danger-a' ? '\tclient-danger'`), 'L45 unique fields must not use fixed dangerous fixture values');
assert(!existsSync('apps/admin/src/pages/dashboard-v2'), 'L46 dashboard not added');
console.log('L45 manual tax review export verifier passed.');