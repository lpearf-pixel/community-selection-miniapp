import { existsSync, readFileSync } from 'node:fs';
function assert(c: unknown, m: string) { if (!c) throw new Error(m); }
const route = readFileSync('apps/api/src/routes/withdrawals.ts', 'utf8');
const page = readFileSync('apps/admin/src/pages/tax-review/TaxReviewPage.tsx', 'utf8');
const e2e = readFileSync('scripts/verify-docker-api-e2e-local.ts', 'utf8');
const report = readFileSync('scripts/generate-stage-report.ts', 'utf8');
const reportVerifier = readFileSync('scripts/verify-report-publish-local.ts', 'utf8');
const adminAccess = readFileSync('apps/api/src/modules/admin-access/admin-access-control.ts', 'utf8');
const adminRequest = readFileSync('apps/admin/src/api/adminRequest.ts', 'utf8');
const contract = readFileSync('scripts/l45-api-contract.ts', 'utf8');
const reportGenerator = readFileSync('scripts/generate-stage-report.ts', 'utf8');
assert(route.includes('/api/admin/tax-records/export.csv'), 'L45 CSV API exists');
assert(route.includes('requireAdminPermission("finance.view")'), 'finance.view is required');
assert(route.includes('requireAdminPermission("finance.export")'), 'finance.export is required');
assert(route.includes('requireAdminPermission("withdrawal.manage")'), 'withdrawal.manage is required');
assert(route.includes('withdrawalScopeWhere(context)'), 'database data scope is reused');
assert(route.includes('prisma.taxRecord.count({ where })') && route.includes('skip: (page - 1) * pageSize') && route.includes('take: pageSize'), 'database pagination exists');
assert(route.includes('csvSafe') && route.includes('/^[=+\\-@\\t\\r\\n]/'), 'CSV formula injection guard exists');
assert(route.includes('无税务扣减模式的税额必须为 0') && route.includes('taxableAmount > baseWithdrawal.amount_cents'), 'none mode and taxable amount validation must exist');
assert(route.includes('Object.hasOwn') && route.includes('hasReviewRequest'), 'idempotency history must use Object.hasOwn for key lookup');
const exportBlock = route.split('"/api/admin/tax-records/export.csv"')[1]?.split('app.get(')[0] ?? '';
assert(exportBlock.includes('orderBy: [{ created_at: "desc" }, { id: "desc" }]') && exportBlock.includes('take: taxExportLimit(options.taxExportLimit) + 1') && !exportBlock.includes('count({ where })'), 'CSV export must use deterministic limit+1 guard instead of count/take race');
assert(route.includes('parseTaxReviewClientRequestId') && route.includes('review_requests') && route.includes('TAX_REVIEW_IDEMPOTENCY_LIMIT') && route.includes('idempotent: true') && route.includes('409'), 'complete tax review idempotency history exists');
assert(route.includes('function jsonValuesEqual(') && route.includes('Object.keys(leftRecord).sort()') && route.includes('jsonValuesEqual(previous.snapshot, requested)'), 'tax review idempotency must compare persisted JSON by semantic value');
assert(!route.includes('JSON.stringify(previous) !== JSON.stringify(requested)'), 'tax review idempotency must not depend on JSON object key order');
assert(e2e.includes('const reorderedReviewPayload = {') && e2e.includes('semantically identical payload must be idempotent regardless of JSON key order'), 'L45 E2E must verify idempotency after JSON round-trip and key reordering');
assert(e2e.includes('new Uint8Array(await csvResponse.arrayBuffer())') && e2e.includes('csvBytes[0] === 0xef') && e2e.includes('csvBytes[1] === 0xbb') && e2e.includes('csvBytes[2] === 0xbf'), 'L45 CSV BOM must be verified from raw response bytes');
assert(e2e.includes('type TaxRecordPage = { items:') && e2e.includes('taxRecordsA.items') && e2e.includes('taxRecordsB.items'), 'L45 must keep the L44 tax-record consumer aligned with the paginated response contract');
assert(!e2e.includes("taxRecordsA.some(") && !e2e.includes("taxRecordsB.some("), 'L45 must not leave raw-array assumptions in the L44 regression scenario');
assert(e2e.includes("new TextDecoder('utf-8').decode(csvBytes.subarray(hasUtf8Bom ? 3 : 0))"), 'L45 CSV body must be decoded after raw BOM verification');
assert(!e2e.includes("csv.charCodeAt(0) === 0xfeff"), 'L45 CSV verifier must not expect Response.text() to preserve BOM');
assert(route.includes('taxAmount > taxableAmount') && route.includes('payableAmount < 0'), 'amount relation validation exists');
const adminClient = readFileSync('apps/admin/src/api/adminTaxReview.ts', 'utf8');
assert(adminClient.includes('downloadTaxReviewCsv') && adminClient.includes('adminFetch') && adminClient.includes('URL.createObjectURL') && adminClient.includes('content-disposition'), 'Admin CSV export must use authenticated blob fetch');
assert(!page.includes('href={taxReviewExportUrl('), 'TaxReviewPage must not use href CSV downloads');
assert(route.includes('ensureTaxExportWithinLimit') && route.includes('taxExportLimit') && route.includes('x-export-total') && route.includes('x-export-truncated') && route.includes('422'), 'CSV export must reject over-limit rather than truncate silently');
assert(route.includes('expected_updated_at') && route.includes('updated_at: w?.updated_at') && route.includes('where: { id, updated_at: expectedUpdatedAt }'), 'tax review must enforce client-side optimistic concurrency');
assert(route.includes('const TAX_MODES') && route.includes('const TAX_STATUSES') && route.includes('const INVOICE_STATUSES') && route.includes('validateTaxCombination'), 'tax status allow-lists and combination validation must exist');
assert(page.includes('系统不会自动报税') && page.includes('系统不会连接外部税务平台') && page.includes('系统不会自动发起打款') && page.includes('仅供内部人工核对'), 'manual review disclaimers exist');
assert(existsSync('apps/admin/src/api/adminTaxReview.ts'), 'Admin API client exists');
for (const required of ['runL45TaxReviewScenario', 'await runL45TaxReviewScenario();', 'Promise.allSettled', 'prisma.withdrawal', 'prisma.taxRecord', 'prisma.adminAuditLog', 'prisma.businessEventLog', 'financeAHeaders', 'financeBHeaders', 'negative taxable', 'none nonzero tax', 'l45_tax_detail_success=true', 'l45_tax_export_over_limit_http_422=true', 'rejected tax review must not mutate Withdrawal', '=HYPERLINK', '+SUM(1,1)', '@cmd', '-1+2']) {
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

assert(adminAccess.includes('data_scope_source') && adminAccess.includes('header_mock') && adminAccess.includes('process.env.NODE_ENV !== "production" && !request.adminUser?.id') && adminAccess.includes('return emptyAdminDataScope()'), 'production session must not trust browser scope headers and must fail closed without persisted scope');
assert(adminRequest.includes('import.meta.env?.DEV === true') && adminRequest.includes('VITE_ADMIN_MOCK_HEADERS') && adminRequest.includes('isAdminMockHeadersEnabled() ? getAdminScopeHeaders() : {}'), 'Admin frontend must only send mock headers in dev or explicit mock mode');
assert(route.includes('parseRequiredMoneyCents') && !route.includes('body.taxable_amount_cents ?? baseWithdrawal.amount_cents') && !route.includes('Number(body.tax_amount_cents'), 'tax review money fields must be strict required numbers without coercion/defaults');
for (const key of ['tax_record_list','tax_record_detail','tax_record_export','tax_review','mark_paid']) assert(contract.includes(key), `L45 API contract missing ${key}`);
assert(contract.includes('fulfilled_count') && contract.includes('applied_count') && contract.includes('idempotent_count') && !contract.includes('idempotent_count?: boolean'), 'concurrent contract must use count fields');
assert(e2e.includes('l45_tax_export_over_limit_http_422=true') && e2e.includes('overLimitApp.inject') && e2e.includes('registerWithdrawalRoutes(overLimitApp, { taxExportLimit: 5 })') && !e2e.includes('process.env.TAX_RECORD_EXPORT_LIMIT') && !e2e.includes('l45_export_limit_guard=true'), 'CSV 422 marker must come from HTTP request, not helper-only marker');
assert(reportGenerator.includes('L45_API_CONTRACT_LIST') && reportGenerator.includes('latestVerifyOutputForManifest.includes(api.runtime_marker)'), 'L45 report API verification must be per-interface from machine contract');
assert(route.includes('提现税务状态未完成或未计算，不能标记已处理", 409') && route.includes('发票状态未确认，不能标记已处理", 409'), 'mark-paid state conflicts must use 409');

const l44Body = e2e.split('async function runL44WithdrawalScenario()')[1]?.split('async function runL45TaxReviewScenario()')[0] ?? '';
assert(!/detailContract|taxReviewContract|exportContract|markPaidContract/.test(l44Body), 'L44 scenario must not reference L45 local contract variables');
assert(e2e.includes('data: { withdrawal_id: withdrawal.id }') && e2e.includes('withdrawalCommission.create') && e2e.includes('return { withdrawal, taxRecord, order, community, commission }'), 'L45 fixture must maintain Commission.withdrawal_id and WithdrawalCommission');
assert(e2e.includes('K1 invalid different after paid') && e2e.includes('same_key_different_invalid_payload') && e2e.includes('K1 valid different after paid') && e2e.includes('same_key_different_valid_payload'), 'L45 E2E must split invalid 400 and valid 409 same-key different payload scenarios');
assert(report.includes('apiRows.length === L45_API_CONTRACT_LIST.length'), 'L45 report API row count must come from contract length');
assert(reportVerifier.includes('L45 中风险：buildTaxRecordWhere 当前会读取可见 Withdrawal ID') && reportVerifier.includes('L45 known medium risk must be in risk section') , 'Report verifier must accept documented L45 medium risk');
assert(!existsSync('scripts/l45-api-contract.js') && existsSync('scripts/l45-api-contract.ts'), 'L45 API contract must have a single TypeScript source');
assert(existsSync('docs/api/l45-admin-tax-review-api.md'), 'Human-readable L45 API spec must exist');
assert(e2e.includes('l45_admin_scope_runtime=true') && e2e.includes('resolveAdminAccessContext'), 'E2E must include runtime admin scope source tests');
assert(!existsSync('.github/workflows/trigger-l45.yml') && !existsSync('scripts/one-time-l45-fix.ts'), 'No temporary workflow trigger files allowed');
assert(!existsSync('apps/admin/src/pages/dashboard-v2'), 'L46 dashboard not added');
console.log('L45 manual tax review export verifier passed.');