from pathlib import Path

route_path = Path('apps/api/src/routes/withdrawals.ts')
route = route_path.read_text()

snapshot_anchor = '''function taxReviewSnapshot(input: { tax_mode: string; tax_status: string; taxable_amount_cents: number; tax_amount_cents: number; tax_rate_basis: string | null; invoice_required: boolean; invoice_status: string; tax_remark: string | null }) {
  return input;
}
'''
helper = '''
function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      jsonValuesEqual(leftRecord[key], rightRecord[key]),
  );
}
'''
if snapshot_anchor not in route:
    raise SystemExit('taxReviewSnapshot anchor not found')
if 'function jsonValuesEqual(' not in route:
    route = route.replace(snapshot_anchor, snapshot_anchor + helper, 1)
old_compare = 'if (JSON.stringify(previous) !== JSON.stringify(requested)) throw httpError("client_request_id 对应的税务复核内容不一致", 409);'
new_compare = 'if (!jsonValuesEqual(previous, requested)) throw httpError("client_request_id 对应的税务复核内容不一致", 409);'
if old_compare not in route:
    raise SystemExit('order-sensitive idempotency comparison not found')
route = route.replace(old_compare, new_compare, 1)
route_path.write_text(route)

e2e_path = Path('scripts/verify-docker-api-e2e-local.ts')
e2e = e2e_path.read_text()
old_repeat = '''  const repeat = await request<{ idempotent?: boolean }>('POST', `/api/admin/withdrawals/${fixtureA.withdrawal.id}/tax-review`, { label: 'POST /api/admin/withdrawals/:id/tax-review L45 idempotent repeat', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: reviewPayload });
  assert(repeat.idempotent === true, 'L45 same client_request_id and same payload must be idempotent');
'''
new_repeat = '''  const reorderedReviewPayload = {
    client_request_id: reviewPayload.client_request_id,
    tax_remark: reviewPayload.tax_remark,
    invoice_status: reviewPayload.invoice_status,
    invoice_required: reviewPayload.invoice_required,
    tax_rate_basis: reviewPayload.tax_rate_basis,
    tax_amount_cents: reviewPayload.tax_amount_cents,
    taxable_amount_cents: reviewPayload.taxable_amount_cents,
    tax_status: reviewPayload.tax_status,
    tax_mode: reviewPayload.tax_mode,
  };
  const repeat = await request<{ idempotent?: boolean }>('POST', `/api/admin/withdrawals/${fixtureA.withdrawal.id}/tax-review`, { label: 'POST /api/admin/withdrawals/:id/tax-review L45 idempotent repeat', headers: { ...financeAHeaders, 'content-type': 'application/json' }, body: reorderedReviewPayload });
  assert(repeat.idempotent === true, 'L45 same client_request_id and semantically identical payload must be idempotent regardless of JSON key order');
'''
if old_repeat not in e2e:
    raise SystemExit('L45 idempotent repeat block not found')
e2e = e2e.replace(old_repeat, new_repeat, 1)
e2e_path.write_text(e2e)

verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
anchor = "assert(route.includes('client_request_id') && route.includes('idempotent: true') && route.includes('409'), 'idempotency conflict handling exists');"
addition = '''
assert(route.includes('function jsonValuesEqual(') && route.includes('Object.keys(leftRecord).sort()') && route.includes('jsonValuesEqual(previous, requested)'), 'tax review idempotency must compare persisted JSON by semantic value');
assert(!route.includes('JSON.stringify(previous) !== JSON.stringify(requested)'), 'tax review idempotency must not depend on JSON object key order');
assert(e2e.includes('const reorderedReviewPayload = {') && e2e.includes('semantically identical payload must be idempotent regardless of JSON key order'), 'L45 E2E must verify idempotency after JSON round-trip and key reordering');
'''.strip()
if anchor not in verifier:
    raise SystemExit('L45 verifier idempotency anchor not found')
if addition not in verifier:
    verifier = verifier.replace(anchor, anchor + '\n' + addition, 1)
verifier_path.write_text(verifier)

doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = '''

## 9. 持久化 JSON 与幂等比较规范

- PostgreSQL `json` / `jsonb`、ORM 和序列化层不保证对象键顺序与请求输入顺序一致。
- 禁止使用原始 `JSON.stringify(previous) === JSON.stringify(current)` 判断持久化 JSON 的业务等价性。
- 幂等请求必须先把默认值、nullable 字段和枚举状态规范化为固定业务快照，再使用递归深比较或键排序后的 canonical serialization。
- 对象键顺序不应影响幂等结果；数组顺序只有在业务语义定义为有序时才参与比较。
- 同一幂等键和语义等价 payload 必须返回幂等成功；同一幂等键和真实字段差异必须返回 409。
- Docker E2E 必须覆盖数据库 round-trip 后的重复请求，并至少一次使用不同属性插入顺序构造语义相同的 payload。
- 静态 verifier 必须禁止顺序敏感的持久化 JSON 比较，但不能把具体 helper 名作为唯一实现方式；门禁应围绕语义等价、canonicalization 或 deep equality。
'''
if '## 9. 持久化 JSON 与幂等比较规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_anchor = '- Docker E2E 必须先等待 `/api/health`，transport 错误必须包含 URL、底层 cause 与容器日志排查命令。'
plan_line = '- 持久化 JSON 的幂等判断必须使用规范化后的语义深比较或 canonical serialization，禁止依赖对象键顺序的原始 `JSON.stringify` 比较。'
if plan_anchor not in plan:
    raise SystemExit('global plan transport anchor not found')
if plan_line not in plan:
    plan = plan.replace(plan_anchor, plan_anchor + '\n' + plan_line, 1)
plan_path.write_text(plan)
