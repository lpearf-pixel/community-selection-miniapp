from pathlib import Path

branch_files = {
    'e2e': Path('scripts/verify-docker-api-e2e-local.ts'),
    'verifier': Path('scripts/verify-l45-manual-tax-review-export-local.ts'),
    'report': Path('scripts/generate-stage-report.ts'),
    'report_verifier': Path('scripts/verify-report-publish-local.ts'),
    'compat': Path('docs/dev/stage-verifier-compatibility.md'),
    'plan': Path('docs/plans/next-stage-development-plan.md'),
    'review': Path('docs/reviews/l45-manual-tax-review-export.md'),
}

# 1. Docker E2E loads the machine-readable API contract and derives status/count expectations.
e2e = branch_files['e2e'].read_text()
if "import { readFileSync } from 'node:fs';" not in e2e:
    e2e = e2e.replace("import { PrismaClient } from '@prisma/client';", "import { readFileSync } from 'node:fs';\nimport { PrismaClient } from '@prisma/client';", 1)

contract_types = """type L45ContractScenario = {
  expected_status?: number;
  idempotent?: boolean;
  fulfilled?: number;
  applied?: number;
};
type L45ApiContract = {
  endpoints: {
    tax_review: {
      method: string;
      path: string;
      status_codes: Record<string, number>;
      scenarios: Record<string, L45ContractScenario>;
      validation_precedence: string[];
    };
    mark_paid: {
      method: string;
      path: string;
      status_codes: Record<string, number>;
      scenarios: Record<string, L45ContractScenario & { withdrawal_status?: string }>;
    };
  };
  test_authoring: {
    contract_file_must_be_loaded: boolean;
    negative_test_single_failure_dimension: boolean;
    valid_payload_required_for_idempotency_conflict_test: boolean;
    route_source_must_be_reviewed: boolean;
  };
};
const L45_API_CONTRACT_PATH = 'docs/api/contracts/l45-admin-tax-review.contract.json';
const L45_API_CONTRACT = JSON.parse(readFileSync(L45_API_CONTRACT_PATH, 'utf8')) as L45ApiContract;

"""
if "const L45_API_CONTRACT_PATH" not in e2e:
    marker = "type ApiResponse<T> = {"
    if marker not in e2e:
        raise SystemExit('E2E ApiResponse marker not found')
    e2e = e2e.replace(marker, contract_types + marker, 1)

run_start = """async function runL45TaxReviewScenario() {
  console.log('=== L45 manual tax review export scenario ===');
"""
run_contract = """async function runL45TaxReviewScenario() {
  console.log('=== L45 manual tax review export scenario ===');
  const taxReviewContract = L45_API_CONTRACT.endpoints.tax_review;
  const markPaidContract = L45_API_CONTRACT.endpoints.mark_paid;
  const concurrentContract = taxReviewContract.scenarios.same_key_concurrent;
  assert(taxReviewContract.method === 'POST' && taxReviewContract.path === '/api/admin/withdrawals/:id/tax-review', 'L45 E2E must load the current tax-review API contract');
  assert(markPaidContract.method === 'POST' && markPaidContract.path === '/api/admin/withdrawals/:id/mark-paid', 'L45 E2E must load the current mark-paid API contract');
  assert(L45_API_CONTRACT.test_authoring.valid_payload_required_for_idempotency_conflict_test === true, 'L45 idempotency conflict tests must use valid payloads');
"""
if run_start in e2e:
    e2e = e2e.replace(run_start, run_contract, 1)
elif "const taxReviewContract = L45_API_CONTRACT.endpoints.tax_review;" not in e2e:
    raise SystemExit('L45 scenario start marker not found')

replacements = {
"expectedStatus: 400, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }": "expectedStatus: taxReviewContract.status_codes.invalid_request, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }",
"expectedStatus: 400, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, client_request_id: 'x'.repeat(81), expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }": "expectedStatus: taxReviewContract.status_codes.invalid_request, body: { tax_mode: 'none', taxable_amount_cents: 2000, tax_amount_cents: 0, client_request_id: 'x'.repeat(81), expected_updated_at: fixtureB.withdrawal.updated_at.toISOString() }",
"expectedStatus: 409, body: { ...k2, client_request_id: `${runId}-paid-new-key`, expected_updated_at: afterPaidReplay.updated_at.toISOString() }": "expectedStatus: taxReviewContract.scenarios.new_key_after_terminal.expected_status, body: { ...k2, client_request_id: `${runId}-paid-new-key`, expected_updated_at: afterPaidReplay.updated_at.toISOString() }",
"expectedStatus: 409, body: { ...k2, client_request_id: `${runId}-stale`, tax_amount_cents: 101, expected_updated_at: fixtureD.withdrawal.updated_at.toISOString() }": "expectedStatus: taxReviewContract.scenarios.stale_new_key.expected_status, body: { ...k2, client_request_id: `${runId}-stale`, tax_amount_cents: 101, expected_updated_at: fixtureD.withdrawal.updated_at.toISOString() }",
"expectedStatus: 409, body: { ...reviewPayload, tax_amount_cents: 121 }": "expectedStatus: taxReviewContract.scenarios.same_key_different_valid_payload.expected_status, body: { ...reviewPayload, tax_amount_cents: 121 }",
"expectedStatus: 400, body });": "expectedStatus: taxReviewContract.status_codes.invalid_request, body });",
}
for old, new in replacements.items():
    if old in e2e:
        e2e = e2e.replace(old, new)

old_conflict = """  await request<ErrorApiResponse>('POST', `/api/admin/withdrawals/${fixtureD.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 K1 different after paid', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { ...k1, tax_amount_cents: 1 } });
"""
new_conflict = """  await request<ErrorApiResponse>('POST', `/api/admin/withdrawals/${fixtureD.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 K1 invalid different after paid', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: taxReviewContract.scenarios.same_key_different_invalid_payload.expected_status, body: { ...k1, tax_amount_cents: 1 } });
  await request<ErrorApiResponse>('POST', `/api/admin/withdrawals/${fixtureD.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 K1 valid different after paid', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: taxReviewContract.scenarios.same_key_different_valid_payload.expected_status, body: { ...k1, tax_mode: 'withheld', tax_amount_cents: 1 } });
"""
if old_conflict in e2e:
    e2e = e2e.replace(old_conflict, new_conflict, 1)
elif "POST tax-review L45 K1 valid different after paid" not in e2e:
    raise SystemExit('K1 after-paid conflict test marker not found')

old_concurrent = """  const concurrent = await Promise.allSettled([
    request('POST', `/api/admin/withdrawals/${fixtureC.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 concurrent A', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1200, tax_amount_cents: 0, client_request_id: `${runId}-concurrent-same`, expected_updated_at: fixtureC.withdrawal.updated_at.toISOString() } }),
    request('POST', `/api/admin/withdrawals/${fixtureC.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 concurrent B', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1200, tax_amount_cents: 0, client_request_id: `${runId}-concurrent-same`, expected_updated_at: fixtureC.withdrawal.updated_at.toISOString() } })
  ]);
  assert(concurrent.filter((result) => result.status === 'fulfilled').length === 2, 'L45 same client_request_id concurrent requests must return one applied and one idempotent');
"""
new_concurrent = """  const concurrent = await Promise.allSettled([
    request<{ idempotent?: boolean }>('POST', `/api/admin/withdrawals/${fixtureC.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 concurrent A', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1200, tax_amount_cents: 0, client_request_id: `${runId}-concurrent-same`, expected_updated_at: fixtureC.withdrawal.updated_at.toISOString() } }),
    request<{ idempotent?: boolean }>('POST', `/api/admin/withdrawals/${fixtureC.withdrawal.id}/tax-review`, { label: 'POST tax-review L45 concurrent B', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: { tax_mode: 'none', taxable_amount_cents: 1200, tax_amount_cents: 0, client_request_id: `${runId}-concurrent-same`, expected_updated_at: fixtureC.withdrawal.updated_at.toISOString() } })
  ]);
  const concurrentFulfilled = concurrent.filter((result): result is PromiseFulfilledResult<{ idempotent?: boolean }> => result.status === 'fulfilled');
  const concurrentAppliedCount = concurrentFulfilled.filter((result) => result.value.idempotent === false).length;
  const concurrentIdempotentCount = concurrentFulfilled.filter((result) => result.value.idempotent === true).length;
  assert(concurrentFulfilled.length === concurrentContract.fulfilled && concurrentAppliedCount === concurrentContract.applied && concurrentIdempotentCount === concurrentContract.idempotent, 'L45 same client_request_id concurrency must match the API contract');
"""
if old_concurrent in e2e:
    e2e = e2e.replace(old_concurrent, new_concurrent, 1)
elif "concurrentAppliedCount" not in e2e:
    raise SystemExit('L45 concurrent block not found')

old_logs = """  console.log(`l45_finance_total=${financeList.total}`);
  console.log(`l45_concurrent_success_count=${concurrent.filter((result) => result.status === 'fulfilled').length}`);
  console.log(`l45_csv_formula_safe=${!executableFormula}`);
"""
new_logs = """  console.log(`l45_finance_total=${financeList.total}`);
  console.log(`l45_concurrent_success_count=${concurrentFulfilled.length}`);
  console.log(`l45_concurrent_applied_count=${concurrentAppliedCount}`);
  console.log(`l45_concurrent_idempotent_count=${concurrentIdempotentCount}`);
  console.log(`l45_csv_formula_safe=${!executableFormula}`);
"""
if old_logs in e2e:
    e2e = e2e.replace(old_logs, new_logs, 1)
elif "l45_concurrent_applied_count" not in e2e:
    raise SystemExit('L45 runtime log block not found')

branch_files['e2e'].write_text(e2e)

# 2. Stage report consumes the same machine contract for runtime marker quantities.
report = branch_files['report'].read_text()
report_contract = """const l45ApiContractPath = join(repoRoot, 'docs/api/contracts/l45-admin-tax-review.contract.json');
const l45ApiContract = JSON.parse(readFileSync(l45ApiContractPath, 'utf8')) as {
  endpoints: {
    tax_review: {
      scenarios: Record<string, { fulfilled?: number; applied?: number; idempotent?: number }>;
    };
  };
};
const l45ConcurrencyContract = l45ApiContract.endpoints.tax_review.scenarios.same_key_concurrent;
"""
repo_marker = "const reportsDir = join(repoRoot, 'reports');\n"
if "const l45ApiContractPath" not in report:
    if repo_marker not in report:
        raise SystemExit('report repo marker not found')
    report = report.replace(repo_marker, repo_marker + report_contract, 1)

old_runtime = "const required = ['=== L45 manual tax review export scenario ===','l45_finance_total=','l45_concurrent_success_count=1','l45_csv_formula_safe=true','l45_tax_detail_success=true','l45_export_limit_guard=true','L45 manual tax review export runtime assertions passed.'];"
new_runtime = "const required = ['=== L45 manual tax review export scenario ===','l45_finance_total=',`l45_concurrent_success_count=${l45ConcurrencyContract.fulfilled}`,`l45_concurrent_applied_count=${l45ConcurrencyContract.applied}`,`l45_concurrent_idempotent_count=${l45ConcurrencyContract.idempotent}`,'l45_csv_formula_safe=true','l45_tax_detail_success=true','l45_export_limit_guard=true','L45 manual tax review export runtime assertions passed.'];"
if old_runtime in report:
    report = report.replace(old_runtime, new_runtime, 1)
elif "l45ConcurrencyContract.fulfilled" not in report:
    raise SystemExit('report L45 runtime marker line not found')

old_command = "['Docker API E2E verification passed.', 'L45 manual tax review export runtime assertions passed.', 'l45_concurrent_success_count=1', 'l45_csv_formula_safe=true', 'l45_tax_detail_success=true', 'l45_export_limit_guard=true']"
new_command = "['Docker API E2E verification passed.', 'L45 manual tax review export runtime assertions passed.', `l45_concurrent_success_count=${l45ConcurrencyContract.fulfilled}`, `l45_concurrent_applied_count=${l45ConcurrencyContract.applied}`, `l45_concurrent_idempotent_count=${l45ConcurrencyContract.idempotent}`, 'l45_csv_formula_safe=true', 'l45_tax_detail_success=true', 'l45_export_limit_guard=true']"
if old_command in report:
    report = report.replace(old_command, new_command, 1)
elif "`l45_concurrent_applied_count=${l45ConcurrencyContract.applied}`" not in report:
    raise SystemExit('report Docker marker array not found')
branch_files['report'].write_text(report)

# 3. L45 verifier enforces docs + machine contract + route + E2E alignment.
verifier = branch_files['verifier'].read_text()
contract_reads = """const apiDocumentPath = 'docs/api/l45-admin-tax-review-api.md';
const apiContractPath = 'docs/api/contracts/l45-admin-tax-review.contract.json';
assert(existsSync(apiDocumentPath), 'L45 human-readable API specification must exist');
assert(existsSync(apiContractPath), 'L45 machine-readable API contract must exist');
const apiDocument = readFileSync(apiDocumentPath, 'utf8');
const apiContract = JSON.parse(readFileSync(apiContractPath, 'utf8')) as {
  source_route: string;
  human_document: string;
  endpoints: {
    tax_review: { method: string; path: string; status_codes: Record<string, number>; validation_precedence: string[]; scenarios: Record<string, { expected_status?: number; fulfilled?: number; applied?: number; idempotent?: number }> };
    mark_paid: { method: string; path: string; status_codes: Record<string, number> };
  };
  test_authoring: Record<string, boolean>;
};
const taxReviewContract = apiContract.endpoints.tax_review;
"""
const_marker = "const reportVerifier = readFileSync('scripts/verify-report-publish-local.ts', 'utf8');\n"
if "const apiContractPath" not in verifier:
    if const_marker not in verifier:
        raise SystemExit('L45 verifier constants marker not found')
    verifier = verifier.replace(const_marker, const_marker + contract_reads, 1)

api_asserts = """assert(apiContract.source_route === 'apps/api/src/routes/withdrawals.ts' && apiContract.human_document === apiDocumentPath, 'L45 API contract must identify its route and human document');
assert(taxReviewContract.method === 'POST' && taxReviewContract.path === '/api/admin/withdrawals/:id/tax-review', 'L45 tax-review method/path contract must match the route');
assert(apiContract.endpoints.mark_paid.method === 'POST' && apiContract.endpoints.mark_paid.path === '/api/admin/withdrawals/:id/mark-paid', 'L45 mark-paid method/path contract must match the route');
assert(taxReviewContract.scenarios.invalid_none_nonzero_tax.expected_status === 400, 'L45 contract must document invalid none/nonzero tax as HTTP 400');
assert(taxReviewContract.scenarios.same_key_different_valid_payload.expected_status === 409, 'L45 contract must document valid same-key conflict as HTTP 409');
assert(taxReviewContract.scenarios.same_key_different_invalid_payload.expected_status === 400, 'L45 contract must document invalid payload precedence as HTTP 400');
assert(apiDocument.includes('校验与状态码优先级') && apiDocument.includes('不同但合法的语义') && apiDocument.includes('不同且非法的 payload'), 'L45 API specification must explain validation/idempotency precedence');
assert(e2e.includes("readFileSync(L45_API_CONTRACT_PATH, 'utf8')") && e2e.includes('taxReviewContract.status_codes.invalid_request'), 'L45 E2E must load and consume the machine-readable API contract');
assert(e2e.includes('POST tax-review L45 K1 invalid different after paid') && e2e.includes('POST tax-review L45 K1 valid different after paid') && e2e.includes("tax_mode: 'withheld', tax_amount_cents: 1"), 'L45 E2E must separate invalid 400 from valid idempotency-conflict 409');
assert(!e2e.includes("label: 'POST tax-review L45 K1 different after paid'") && !e2e.includes("body: { ...k1, tax_amount_cents: 1 } });"), 'L45 E2E must not use an invalid none-mode payload to expect idempotency conflict');
assert(e2e.includes('concurrentFulfilled.length === concurrentContract.fulfilled') && e2e.includes('concurrentAppliedCount === concurrentContract.applied') && e2e.includes('concurrentIdempotentCount === concurrentContract.idempotent'), 'L45 concurrency E2E must use contract quantities');
assert(report.includes('l45ApiContractPath') && report.includes('l45ConcurrencyContract'), 'L45 report generator must consume the API contract');
"""
insert_after = "assert(route.includes('Object.hasOwn') && route.includes('hasReviewRequest'), 'idempotency history must use Object.hasOwn for key lookup');\n"
if api_asserts not in verifier:
    if insert_after not in verifier:
        raise SystemExit('L45 verifier idempotency anchor not found')
    verifier = verifier.replace(insert_after, insert_after + api_asserts, 1)
branch_files['verifier'].write_text(verifier)

# 4. Report publish verifier protects contract-driven evidence.
publish = branch_files['report_verifier'].read_text()
publish_anchor = "assert(!generateSource.includes(\"permissions: ['public']\"), 'L44 report permissions must not be public');"
publish_add = """assert(generateSource.includes('l45-admin-tax-review.contract.json') && generateSource.includes('l45ConcurrencyContract'), 'L45 report generator must read the machine-readable API contract');
assert(dockerE2eSource.includes('L45_API_CONTRACT_PATH') && dockerE2eSource.includes('taxReviewContract.status_codes.invalid_request') && dockerE2eSource.includes('concurrentContract.fulfilled'), 'L45 Docker E2E must consume API contract status and concurrency expectations');
"""
# dockerE2eSource is declared later, so place first assertion before permissions and second after declaration loop.
first_line = "assert(generateSource.includes('l45-admin-tax-review.contract.json') && generateSource.includes('l45ConcurrencyContract'), 'L45 report generator must read the machine-readable API contract');\n"
if first_line not in publish:
    if publish_anchor not in publish:
        raise SystemExit('report publish permissions anchor not found')
    publish = publish.replace(publish_anchor, first_line + publish_anchor, 1)
second_anchor = "assert(!dockerE2eSource.includes('const l44RuntimeEvidence'), 'L44 Docker E2E must not use hardcoded evidence object');\n"
second_line = "assert(dockerE2eSource.includes('L45_API_CONTRACT_PATH') && dockerE2eSource.includes('taxReviewContract.status_codes.invalid_request') && dockerE2eSource.includes('concurrentContract.fulfilled'), 'L45 Docker E2E must consume API contract status and concurrency expectations');\n"
if second_line not in publish:
    if second_anchor not in publish:
        raise SystemExit('report publish Docker source anchor not found')
    publish = publish.replace(second_anchor, second_anchor + second_line, 1)
branch_files['report_verifier'].write_text(publish)

# 5. Global governance: tests must read the interface contract before authoring assertions.
compat = branch_files['compat'].read_text()
section = """

## 15. 接口契约驱动测试规范

- 新增或修改 API 时，必须同时维护人类可读接口说明书和机器可读接口契约；路由实现、接口文档、契约文件和 E2E 必须在同一个 PR 中更新。
- E2E、集成测试和报告 detector 在编写状态码、方法、路径、并发数量前，必须读取对应机器契约，禁止凭经验硬编码接口行为。
- 测试作者必须先阅读路由实现和接口说明书，再设计 fixture 与断言；测试脚本应在启动时验证契约中的 method/path 与实际目标一致。
- 每个负向用例只允许制造一个失败维度。测试幂等键冲突时，两份 payload 都必须先满足字段、枚举和金额规则；非法 payload 应按接口校验优先级断言 400，而不是误期望 409。
- 接口校验顺序属于公开契约。字段校验、幂等比较、终态检查、乐观锁等优先级变化时，必须同步更新契约、说明书、E2E、stage report detector 和 report publish verifier。
- 静态 verifier 必须检查测试确实读取机器契约，而不能只检查契约文件存在。
"""
if '## 15. 接口契约驱动测试规范' not in compat:
    compat = compat.rstrip() + section + '\n'
branch_files['compat'].write_text(compat)

plan = branch_files['plan'].read_text()
plan_line = '- API 测试必须先读取对应人类接口说明书和机器可读契约，再编写状态码、payload、并发与状态迁移断言；负向用例每次只制造一个失败维度。'
if plan_line not in plan:
    plan = plan.rstrip() + '\n' + plan_line + '\n'
branch_files['plan'].write_text(plan)

review = branch_files['review'].read_text()
review_section = """

## 接口契约

- 人类可读说明：`docs/api/l45-admin-tax-review-api.md`
- 机器可读契约：`docs/api/contracts/l45-admin-tax-review.contract.json`
- L45 Docker E2E 必须读取机器契约后再断言状态码、幂等冲突和并发数量。
"""
if '## 接口契约' not in review:
    review = review.rstrip() + review_section + '\n'
branch_files['review'].write_text(review)
