from pathlib import Path

# Trigger the one-time workflow after its definition exists on the branch.
# Align E2E runtime evidence with the current same-key concurrency contract.
e2e_path = Path('scripts/verify-docker-api-e2e-local.ts')
e2e = e2e_path.read_text()
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
  assert(concurrentFulfilled.length === 2 && concurrentAppliedCount === 1 && concurrentIdempotentCount === 1, 'L45 same client_request_id concurrent requests must return exactly one applied and one idempotent result');
"""
if old_concurrent not in e2e:
    raise SystemExit('old L45 concurrent block not found')
e2e = e2e.replace(old_concurrent, new_concurrent, 1)
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
if old_logs not in e2e:
    raise SystemExit('old L45 runtime marker block not found')
e2e = e2e.replace(old_logs, new_logs, 1)
e2e_path.write_text(e2e)

# Update the current-stage verifier to require exact concurrency evidence and report alignment.
verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
anchor = "assert(e2e.includes('const reorderedReviewPayload = {') && e2e.includes('semantically identical payload must be idempotent regardless of JSON key order'), 'L45 E2E must verify idempotency after JSON round-trip and key reordering');"
addition = """
assert(e2e.includes('concurrentAppliedCount === 1') && e2e.includes('concurrentIdempotentCount === 1'), 'L45 E2E must prove exactly one applied and one idempotent result for concurrent same-key requests');
assert(e2e.includes('l45_concurrent_success_count=${concurrentFulfilled.length}') && e2e.includes('l45_concurrent_applied_count=${concurrentAppliedCount}') && e2e.includes('l45_concurrent_idempotent_count=${concurrentIdempotentCount}'), 'L45 E2E must publish exact current concurrency runtime markers');
assert(report.includes('l45_concurrent_success_count=2') && report.includes('l45_concurrent_applied_count=1') && report.includes('l45_concurrent_idempotent_count=1'), 'L45 report generator must consume the current same-key concurrency evidence');
""".strip()
if anchor not in verifier:
    raise SystemExit('L45 verifier idempotency anchor not found')
if addition not in verifier:
    verifier = verifier.replace(anchor, anchor + '\n' + addition, 1)
verifier_path.write_text(verifier)

# Replace stale report markers in both runtime manifest and command-level verification.
report_path = Path('scripts/generate-stage-report.ts')
report = report_path.read_text()
old_runtime = "const required = ['=== L45 manual tax review export scenario ===','l45_finance_total=','l45_concurrent_success_count=1','l45_csv_formula_safe=true','L45 manual tax review export runtime assertions passed.'];"
new_runtime = "const required = ['=== L45 manual tax review export scenario ===','l45_finance_total=','l45_concurrent_success_count=2','l45_concurrent_applied_count=1','l45_concurrent_idempotent_count=1','l45_csv_formula_safe=true','L45 manual tax review export runtime assertions passed.'];"
if old_runtime not in report:
    raise SystemExit('old L45 manifest runtime markers not found')
report = report.replace(old_runtime, new_runtime, 1)
old_command = "['Docker API E2E verification passed.', 'L45 manual tax review export runtime assertions passed.', 'l45_concurrent_success_count=1', 'l45_csv_formula_safe=true']"
new_command = "['Docker API E2E verification passed.', 'L45 manual tax review export runtime assertions passed.', 'l45_concurrent_success_count=2', 'l45_concurrent_applied_count=1', 'l45_concurrent_idempotent_count=1', 'l45_csv_formula_safe=true']"
if old_command not in report:
    raise SystemExit('old L45 Docker report command markers not found')
report = report.replace(old_command, new_command, 1)
report_path.write_text(report)

# Strengthen report publication verifier so stale evidence cannot regress.
publish_path = Path('scripts/verify-report-publish-local.ts')
publish = publish_path.read_text()
anchor_publish = "for (const required of ['runL45TaxReviewScenario', 'POST /api/admin/withdrawals/:id/tax-review', 'Promise.allSettled', 'prisma.withdrawal', 'prisma.taxRecord', 'prisma.adminAuditLog', 'prisma.businessEventLog', 'financeNoScopeHeaders', 'fixtureB', 'negative taxable', '=HYPERLINK', '+SUM(1,1)', '@cmd', '-1+2', 'l45_csv_formula_safe']) {"
if anchor_publish not in publish:
    raise SystemExit('report publish L45 E2E marker loop not found')
publish = publish.replace("'l45_csv_formula_safe'])", "'l45_concurrent_success_count', 'l45_concurrent_applied_count', 'l45_concurrent_idempotent_count', 'l45_csv_formula_safe'])", 1)
static_anchor = "assert(!generateSource.includes(\"permissions: ['public']\"), 'L44 report permissions must not be public');"
static_addition = """
assert(generateSource.includes('l45_concurrent_success_count=2') && generateSource.includes('l45_concurrent_applied_count=1') && generateSource.includes('l45_concurrent_idempotent_count=1'), 'L45 report generator must require current same-key concurrency evidence');
assert(!generateSource.includes('l45_concurrent_success_count=1'), 'L45 report generator must not retain the obsolete one-success concurrency marker');
""".strip()
if static_anchor not in publish:
    raise SystemExit('report publish permissions anchor not found')
if static_addition not in publish:
    publish = publish.replace(static_anchor, static_addition + '\n' + static_anchor, 1)
publish_path.write_text(publish)

# Record the general governance rule for runtime evidence changes.
doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = """

## 13. 运行时 Marker 与业务断言同步规范

- 运行时 marker 必须来自已经通过的业务断言变量，不能由报告脚本猜测或硬编码旧数量。
- 并发、幂等或状态机语义发生变化时，必须同步审计 Docker E2E 输出、stage report runtime marker、verification row detector 和 report publish verifier。
- “请求成功数”不足以证明幂等语义；同键并发场景必须分别输出并验证 applied 数和 idempotent 数。
- 报告生成器不得为了兼容旧输出接受互相矛盾的多个 marker；应只接受当前公开业务契约。
- 完整 chain 通过后，报告应基于同一次运行产生的 marker，禁止复用旧 head 的 latest verify output。
"""
if '## 13. 运行时 Marker 与业务断言同步规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_anchor = '- Mutation API 新增必填幂等键或 `expected_updated_at` 等安全字段时，必须同步更新所有旧阶段调用；禁止为兼容旧测试而降低新接口约束。'
plan_line = '- 并发或幂等语义变化时，必须同步更新 E2E marker、stage report detector 与 report publish verifier；同键并发需分别验证 applied 与 idempotent 数量。'
if plan_anchor not in plan:
    raise SystemExit('global plan mutation-contract anchor not found')
if plan_line not in plan:
    plan = plan.replace(plan_anchor, plan_anchor + '\n' + plan_line, 1)
plan_path.write_text(plan)
