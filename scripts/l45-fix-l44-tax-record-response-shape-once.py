from pathlib import Path

# Trigger the one-time workflow after its definition exists on the branch.
# 1. Update Docker E2E L44 consumer to the L45 paginated response contract.
e2e_path = Path('scripts/verify-docker-api-e2e-local.ts')
e2e = e2e_path.read_text()
old = '''  const taxRecordsA = await request<Array<{ id: string }>>('GET', `/api/admin/tax-records?source_type=withdrawal&source_id=${scopeBW.withdrawal_id}`, { label: 'L44 tax records scoped finance A excludes B', headers: financeAHeaders });
  const taxRecordsB = await request<Array<{ id: string }>>('GET', `/api/admin/tax-records?source_type=withdrawal&source_id=${scopeBW.withdrawal_id}`, { label: 'L44 tax records scoped finance B includes B', headers: financeBHeaders });
  assert(!taxRecordsA.some((item) => item.id === taxRecord.id) && taxRecordsB.some((item) => item.id === taxRecord.id), 'L44 tax-records must apply withdrawal data scope');
'''
new = '''  type TaxRecordPage = { items: Array<{ tax_record_id: string; withdrawal_id: string | null }>; total: number; page: number; page_size: number };
  const taxRecordsA = await request<TaxRecordPage>('GET', `/api/admin/tax-records?source_type=withdrawal&source_id=${scopeBW.withdrawal_id}`, { label: 'L44 tax records scoped finance A excludes B', headers: financeAHeaders });
  const taxRecordsB = await request<TaxRecordPage>('GET', `/api/admin/tax-records?source_type=withdrawal&source_id=${scopeBW.withdrawal_id}`, { label: 'L44 tax records scoped finance B includes B', headers: financeBHeaders });
  assert(Array.isArray(taxRecordsA.items) && taxRecordsA.total === 0 && taxRecordsA.items.length === 0, 'L44 scoped finance A tax-record page must exclude the scope B record');
  assert(Array.isArray(taxRecordsB.items) && taxRecordsB.total === 1 && taxRecordsB.items.length === 1 && taxRecordsB.items[0].tax_record_id === taxRecord.id && taxRecordsB.items[0].withdrawal_id === scopeBW.withdrawal_id, 'L44 scoped finance B tax-record page must include the exact scope B record');
'''
if old not in e2e:
    raise SystemExit('old L44 tax-record array consumer block not found')
e2e = e2e.replace(old, new, 1)
e2e_path.write_text(e2e)

# 2. Strengthen the L44 verifier so the old stage follows the public response contract.
l44_path = Path('scripts/verify-l44-manual-withdrawal-review-local.ts')
l44 = l44_path.read_text()
anchor = "assert(!l44Function.includes('const l44RuntimeEvidence'), 'L44 E2E must not use hardcoded evidence object');"
addition = '''
assert(l44Function.includes('type TaxRecordPage = { items:') && l44Function.includes('taxRecordsA.items') && l44Function.includes('taxRecordsB.items'), 'L44 E2E tax-record consumer must use the paginated response envelope');
assert(l44Function.includes('tax_record_id') && l44Function.includes('withdrawal_id'), 'L44 E2E tax-record assertions must use the current DTO field names');
assert(!l44Function.includes("request<Array<{ id: string }>>('GET', `/api/admin/tax-records"), 'L44 E2E must not treat the paginated tax-record API as a raw array');
'''.strip()
if anchor not in l44:
    raise SystemExit('L44 verifier E2E anchor not found')
if addition not in l44:
    l44 = l44.replace(anchor, anchor + '\n' + addition, 1)
l44_path.write_text(l44)

# 3. Strengthen the current-stage verifier too, so a later refactor cannot regress L44.
l45_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
l45 = l45_path.read_text()
anchor45 = "assert(e2e.includes('new Uint8Array(await csvResponse.arrayBuffer())') && e2e.includes('csvBytes[0] === 0xef') && e2e.includes('csvBytes[1] === 0xbb') && e2e.includes('csvBytes[2] === 0xbf'), 'L45 CSV BOM must be verified from raw response bytes');"
addition45 = '''
assert(e2e.includes('type TaxRecordPage = { items:') && e2e.includes('taxRecordsA.items') && e2e.includes('taxRecordsB.items'), 'L45 must keep the L44 tax-record consumer aligned with the paginated response contract');
assert(!e2e.includes("taxRecordsA.some(") && !e2e.includes("taxRecordsB.some("), 'L45 must not leave raw-array assumptions in the L44 regression scenario');
'''.strip()
if anchor45 not in l45:
    raise SystemExit('L45 verifier CSV anchor not found')
if addition45 not in l45:
    l45 = l45.replace(anchor45, anchor45 + '\n' + addition45, 1)
l45_path.write_text(l45)

# 4. Add the cross-stage response contract rule.
doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = '''

## 11. API 响应契约与跨阶段消费者规范

- API 从裸数组升级为分页 envelope、字段重命名或嵌套结构调整时，必须搜索并更新所有旧阶段 E2E、Admin/小程序客户端、类型定义和 verifier 消费者。
- 测试不得只依赖 TypeScript 泛型“声明”响应形状；必须对运行时 envelope（如 `items`、`total`、`page`、`page_size`）执行断言后再访问记录。
- 分页接口禁止继续对响应根对象调用 `.some()`、`.map()`、`.length` 等数组方法；应明确访问 `response.items`。
- DTO 字段必须使用接口当前公开名称，例如 `tax_record_id`，不得继续假设 Prisma 原始字段 `id`。
- 新阶段改变既有 API shape 时，完整 chain 中所有受影响旧阶段场景都必须真实运行；不能只修改当前阶段 verifier。
- 静态 verifier 应阻止已知旧 shape，但不能把某一个局部变量名作为唯一门禁；重点应是 envelope 与 DTO 的公开契约。
'''
if '## 11. API 响应契约与跨阶段消费者规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_anchor = '- CSV BOM、文件签名等传输层属性必须检查原始响应字节，禁止用 `Response.text()` 解码后的字符串冒充字节证据。'
plan_line = '- API 响应 envelope 或 DTO 字段变化时，必须审计并更新所有旧阶段 E2E、客户端类型和 verifier；分页响应统一通过 `items` 访问记录。'
if plan_anchor not in plan:
    raise SystemExit('global plan raw-byte anchor not found')
if plan_line not in plan:
    plan = plan.replace(plan_anchor, plan_anchor + '\n' + plan_line, 1)
plan_path.write_text(plan)
