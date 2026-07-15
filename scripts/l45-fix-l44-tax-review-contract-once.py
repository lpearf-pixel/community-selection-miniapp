from pathlib import Path

# Trigger the one-time workflow after its definition exists on the branch.
# Update the L44 Docker E2E compatibility call to the current L45 mutation contract.
e2e_path = Path('scripts/verify-docker-api-e2e-local.ts')
e2e = e2e_path.read_text()
old = """  await request('POST', `/api/admin/withdrawals/${paidW.withdrawal_id}/tax-review`, withAdminJson({ label: 'L44 tax compatibility none', body: { tax_mode: 'none', tax_amount_cents: 0 } }));
"""
new = """  const l44PaidTaxVersion = await prisma.withdrawal.findUniqueOrThrow({ where: { id: paidW.withdrawal_id } });
  await request('POST', `/api/admin/withdrawals/${paidW.withdrawal_id}/tax-review`, withAdminJson({ label: 'L44 tax compatibility none', body: { tax_mode: 'none', tax_amount_cents: 0, client_request_id: `${runId}-l44-tax-none`, expected_updated_at: l44PaidTaxVersion.updated_at.toISOString() } }));
"""
if old not in e2e:
    raise SystemExit('old L44 tax compatibility call not found')
e2e = e2e.replace(old, new, 1)
e2e_path.write_text(e2e)

# Keep the old-stage verifier aligned with the new required mutation fields.
l44_path = Path('scripts/verify-l44-manual-withdrawal-review-local.ts')
l44 = l44_path.read_text()
anchor = "assert(!l44Function.includes('const l44RuntimeEvidence'), 'L44 E2E must not use hardcoded evidence object');"
addition = """
const l44TaxCompatibilityStart = l44Function.indexOf('const l44PaidTaxVersion');
const l44TaxCompatibilityEnd = l44Function.indexOf('const markPaid', l44TaxCompatibilityStart);
assert(l44TaxCompatibilityStart >= 0 && l44TaxCompatibilityEnd > l44TaxCompatibilityStart, 'L44 paid scenario must read the current Withdrawal version before tax review');
const l44TaxCompatibilityBlock = l44Function.slice(l44TaxCompatibilityStart, l44TaxCompatibilityEnd);
assert(l44TaxCompatibilityBlock.includes('client_request_id') && l44TaxCompatibilityBlock.includes('expected_updated_at') && l44TaxCompatibilityBlock.includes('updated_at.toISOString()'), 'L44 tax compatibility call must satisfy the current idempotency and optimistic-concurrency contract');
""".strip()
if anchor not in l44:
    raise SystemExit('L44 verifier E2E anchor not found')
if addition not in l44:
    l44 = l44.replace(anchor, anchor + '\n' + addition, 1)
l44_path.write_text(l44)

# Also enforce the cross-stage compatibility call from the current-stage verifier.
l45_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
l45 = l45_path.read_text()
anchor45 = "assert(e2e.includes('type TaxRecordPage = { items:') && e2e.includes('taxRecordsA.items') && e2e.includes('taxRecordsB.items'), 'L45 must keep the L44 tax-record consumer aligned with the paginated response contract');"
addition45 = """
assert(e2e.includes('const l44PaidTaxVersion = await prisma.withdrawal.findUniqueOrThrow') && e2e.includes('`${runId}-l44-tax-none`') && e2e.includes('expected_updated_at: l44PaidTaxVersion.updated_at.toISOString()'), 'L45 must keep the L44 tax-review compatibility call aligned with required idempotency and version fields');
""".strip()
if anchor45 not in l45:
    raise SystemExit('L45 verifier L44 response-contract anchor not found')
if addition45 not in l45:
    l45 = l45.replace(anchor45, anchor45 + '\n' + addition45, 1)
l45_path.write_text(l45)

# Record the general cross-stage mutation contract rule.
doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = """

## 12. Mutation 请求契约与旧阶段兼容规范

- 新阶段为既有 mutation API 增加必填幂等键、版本字段、状态字段或其他安全参数时，必须搜索并更新所有旧阶段 E2E、客户端调用、示例、文档和 verifier。
- 不得为了让旧调用继续通过而把新安全字段重新改为可选；应让旧调用读取当前资源版本并提供每次运行唯一的幂等键。
- 需要 optimistic concurrency 的调用必须在前置 mutation 完成后重新读取最新 `updated_at`，禁止继续使用创建 fixture 时的陈旧版本。
- 静态 verifier 应检查旧阶段调用满足当前公开 mutation contract，并由完整 chain 进行真实运行验证。
- 错误修复必须同时覆盖当前阶段和受影响的历史阶段，避免单独运行当前阶段时通过、完整 chain 时失败。
"""
if '## 12. Mutation 请求契约与旧阶段兼容规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_anchor = '- API 响应 envelope 或 DTO 字段变化时，必须审计并更新所有旧阶段 E2E、客户端类型和 verifier；分页响应统一通过 `items` 访问记录。'
plan_line = '- Mutation API 新增必填幂等键或 `expected_updated_at` 等安全字段时，必须同步更新所有旧阶段调用；禁止为兼容旧测试而降低新接口约束。'
if plan_anchor not in plan:
    raise SystemExit('global plan API response-contract anchor not found')
if plan_line not in plan:
    plan = plan.replace(plan_anchor, plan_anchor + '\n' + plan_line, 1)
plan_path.write_text(plan)
