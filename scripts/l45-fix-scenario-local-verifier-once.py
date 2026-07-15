from pathlib import Path

verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
old = "assert(!e2e.includes(\"label: 'POST tax-review L45 K1 different after paid'\") && !e2e.includes(\"body: { ...k1, tax_amount_cents: 1 } });\"), 'L45 E2E must not use an invalid none-mode payload to expect idempotency conflict');"
new = """const invalidAfterPaidLine = e2e.split(/\\r?\\n/).find((line) => line.includes(\"label: 'POST tax-review L45 K1 invalid different after paid'\"));
const validAfterPaidLine = e2e.split(/\\r?\\n/).find((line) => line.includes(\"label: 'POST tax-review L45 K1 valid different after paid'\"));
assert(invalidAfterPaidLine?.includes('same_key_different_invalid_payload.expected_status') && invalidAfterPaidLine.includes('body: { ...k1, tax_amount_cents: 1 }'), 'L45 invalid same-key payload scenario must use the contract HTTP 400 expectation');
assert(validAfterPaidLine?.includes('same_key_different_valid_payload.expected_status') && validAfterPaidLine.includes(\"tax_mode: 'withheld', tax_amount_cents: 1\"), 'L45 valid same-key conflict scenario must use a valid payload and the contract HTTP 409 expectation');
assert(!e2e.includes(\"label: 'POST tax-review L45 K1 different after paid'\"), 'L45 E2E must not retain the ambiguous pre-contract conflict scenario');"""
if old not in verifier:
    raise SystemExit('broad verifier assertion not found')
verifier_path.write_text(verifier.replace(old, new, 1))

compat_path = Path('docs/dev/stage-verifier-compatibility.md')
compat = compat_path.read_text()
rule = '- 静态 verifier 检查负向场景时，必须先定位具体命名场景或代码块，再核对该场景的 payload 与契约状态码；禁止用全文件 substring 黑名单否定一个在其他合法场景中允许出现的片段。'
if rule not in compat:
    compat = compat.rstrip() + '\n' + rule + '\n'
compat_path.write_text(compat)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_rule = '- 静态 verifier 必须按命名场景/代码块做语义校验，不得用全文件字符串黑名单误伤其他合法测试场景。'
if plan_rule not in plan:
    plan = plan.rstrip() + '\n' + plan_rule + '\n'
plan_path.write_text(plan)

# trigger one-time workflow
