from pathlib import Path

# Trigger the one-time workflow after its definition exists on the branch.
branch_file = Path('scripts/verify-docker-api-e2e-local.ts')
source = branch_file.read_text()
old = '''  const csvResponse = await fetchOrThrow('GET', '/api/admin/tax-records/export.csv', { headers: financeAHeaders });
  const csv = await csvResponse.text();
  const disposition = csvResponse.headers.get('content-disposition') ?? '';
  record('GET /api/admin/tax-records/export.csv L45 scoped', { status: csvResponse.status, disposition, raw: csv.slice(0, 1500) });
  assert(csvResponse.ok && csv.charCodeAt(0) === 0xfeff, 'L45 CSV must be UTF-8 BOM text');
'''
new = '''  const csvResponse = await fetchOrThrow('GET', '/api/admin/tax-records/export.csv', { headers: financeAHeaders });
  const csvBytes = new Uint8Array(await csvResponse.arrayBuffer());
  const hasUtf8Bom = csvBytes.length >= 3 && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf;
  const csv = new TextDecoder('utf-8').decode(csvBytes.subarray(hasUtf8Bom ? 3 : 0));
  const disposition = csvResponse.headers.get('content-disposition') ?? '';
  record('GET /api/admin/tax-records/export.csv L45 scoped', { status: csvResponse.status, disposition, utf8_bom: hasUtf8Bom, first_bytes: Array.from(csvBytes.slice(0, 3)), raw: csv.slice(0, 1500) });
  assert(csvResponse.ok && hasUtf8Bom, `L45 CSV must start with UTF-8 BOM bytes EF BB BF; actual=${Array.from(csvBytes.slice(0, 3)).map((value) => value.toString(16).padStart(2, '0')).join(' ')}`);
'''
if old not in source:
    raise SystemExit('old L45 CSV BOM assertion block not found')
source = source.replace(old, new, 1)
branch_file.write_text(source)

verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
anchor = "assert(e2e.includes('const reorderedReviewPayload = {') && e2e.includes('semantically identical payload must be idempotent regardless of JSON key order'), 'L45 E2E must verify idempotency after JSON round-trip and key reordering');"
addition = '''
assert(e2e.includes('new Uint8Array(await csvResponse.arrayBuffer())') && e2e.includes('csvBytes[0] === 0xef') && e2e.includes('csvBytes[1] === 0xbb') && e2e.includes('csvBytes[2] === 0xbf'), 'L45 CSV BOM must be verified from raw response bytes');
assert(e2e.includes("new TextDecoder('utf-8').decode(csvBytes.subarray(hasUtf8Bom ? 3 : 0))"), 'L45 CSV body must be decoded after raw BOM verification');
assert(!e2e.includes("csv.charCodeAt(0) === 0xfeff"), 'L45 CSV verifier must not expect Response.text() to preserve BOM');
'''.strip()
if anchor not in verifier:
    raise SystemExit('L45 verifier JSON idempotency anchor not found')
if addition not in verifier:
    verifier = verifier.replace(anchor, anchor + '\n' + addition, 1)
verifier_path.write_text(verifier)

doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = '''

## 10. HTTP 文本解码与原始字节验证规范

- `Response.text()`、`TextDecoder` 等文本解码层可能消费 UTF-8 BOM；解码后的首字符不是 `U+FEFF`，不能证明响应缺少 BOM。
- CSV BOM、文件签名、压缩头、图片魔数等传输层属性必须通过 `arrayBuffer()` / 原始字节验证，禁止对解码后的字符串使用 `charCodeAt(0)` 作为字节证据。
- UTF-8 BOM 应精确验证前三个字节为 `0xEF 0xBB 0xBF`；验证后再从 BOM 之后解码正文。
- 调试日志应记录首字节数组和 BOM 判断结果，但不得把完整敏感文件内容写入日志。
- 静态 verifier 必须阻止把文本解码结果冒充原始传输字节证据。
'''
if '## 10. HTTP 文本解码与原始字节验证规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
anchor_plan = '- 持久化 JSON 的幂等判断必须使用规范化后的语义深比较或 canonical serialization，禁止依赖对象键顺序的原始 `JSON.stringify` 比较。'
line = '- CSV BOM、文件签名等传输层属性必须检查原始响应字节，禁止用 `Response.text()` 解码后的字符串冒充字节证据。'
if anchor_plan not in plan:
    raise SystemExit('global plan JSON idempotency anchor not found')
if line not in plan:
    plan = plan.replace(anchor_plan, anchor_plan + '\n' + line, 1)
plan_path.write_text(plan)
