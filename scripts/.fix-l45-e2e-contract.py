from pathlib import Path

E2E = Path('scripts/verify-docker-api-e2e-local.ts')
source = E2E.read_text()
replacements = {
"""  const financeList = await request<{ items: Array<{ withdrawal_id: string; leader_phone_masked?: string }>; total: number; page: number; page_size: number }>('GET', `/api/admin/tax-records?page=1&page_size=1&keyword=${encodeURIComponent(runId)}`, { label: 'GET /api/admin/tax-records L45 finance', headers: financeAHeaders });
  assert(financeList.total >= 2 && financeList.items.length === 1 && financeList.page === 1, 'L45 finance list must return database count/skip/take page');
""": """  const financeList = await request<{ items: Array<{ withdrawal_id: string; leader_phone_masked?: string }>; total: number; page: number; page_size: number }>('GET', '/api/admin/tax-records?page=1&page_size=1', { label: 'GET /api/admin/tax-records L45 finance', headers: financeAHeaders });
  assert(financeList.total === 2 && financeList.items.length === 1 && financeList.page === 1 && financeList.page_size === 1, 'L45 finance list must return the two scoped fixtures with database count/skip/take pagination');
""",
"""  const page2 = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?page=2&page_size=1&keyword=${encodeURIComponent(runId)}`, { label: 'GET /api/admin/tax-records L45 page 2', headers: financeAHeaders });
""": """  const page2 = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', '/api/admin/tax-records?page=2&page_size=1', { label: 'GET /api/admin/tax-records L45 page 2', headers: financeAHeaders });
""",
"""  const filtered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?tax_status=pending&tax_mode=pending_review&invoice_status=not_required&from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400_000).toISOString())}&keyword=${encodeURIComponent('danger-a')}`, { label: 'GET /api/admin/tax-records L45 filters', headers: financeAHeaders });
  assert(filtered.items.some((item) => item.withdrawal_id === fixtureA.withdrawal.id) && filtered.items.every((item) => item.withdrawal_id !== fixtureB.withdrawal.id), 'L45 status/mode/invoice/date/keyword filters and scope must apply');
  const scopeAAll = await request<{ items: Array<{ withdrawal_id: string }> }>('GET', `/api/admin/tax-records?page=1&page_size=20&keyword=${encodeURIComponent(runId)}`, { label: 'GET /api/admin/tax-records L45 scope A', headers: financeAHeaders });
""": """  const filtered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?tax_status=pending&tax_mode=pending_review&invoice_status=not_required&from=${encodeURIComponent(new Date(Date.now() - 86400_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 86400_000).toISOString())}&withdrawal_id=${encodeURIComponent(fixtureA.withdrawal.id)}`, { label: 'GET /api/admin/tax-records L45 filters', headers: financeAHeaders });
  assert(filtered.total === 1 && filtered.items.length === 1 && filtered.items[0].withdrawal_id === fixtureA.withdrawal.id, 'L45 status/mode/invoice/date/withdrawal filters and scope must apply');
  const keywordFiltered = await request<{ items: Array<{ withdrawal_id: string }>; total: number }>('GET', `/api/admin/tax-records?keyword=${encodeURIComponent(leaderA.nickname ?? '')}`, { label: 'GET /api/admin/tax-records L45 keyword', headers: financeAHeaders });
  assert(keywordFiltered.total === 1 && keywordFiltered.items[0]?.withdrawal_id === fixtureA.withdrawal.id, 'L45 keyword must match an explicitly searchable fixture field');
  const scopeAAll = await request<{ items: Array<{ withdrawal_id: string }> }>('GET', '/api/admin/tax-records?page=1&page_size=20', { label: 'GET /api/admin/tax-records L45 scope A', headers: financeAHeaders });
""",
"""  const csvResponse = await fetch(`${API_BASE_URL}/api/admin/tax-records/export.csv?keyword=${encodeURIComponent(runId)}`, { headers: financeAHeaders });
""": """  const csvResponse = await fetch(`${API_BASE_URL}/api/admin/tax-records/export.csv`, { headers: financeAHeaders });
""",
"""  const csvFiltered = await requestText('GET', `/api/admin/tax-records/export.csv?keyword=${encodeURIComponent('does-not-match-l45')}`, { label: 'GET /api/admin/tax-records/export.csv L45 filtered empty', headers: financeAHeaders });
""": """  const csvFiltered = await requestText('GET', `/api/admin/tax-records/export.csv?withdrawal_id=${encodeURIComponent('does-not-match-l45')}`, { label: 'GET /api/admin/tax-records/export.csv L45 filtered empty', headers: financeAHeaders });
""",
}
for old, new in replacements.items():
    if old not in source:
        raise SystemExit(f'missing expected E2E block: {old[:100]!r}')
    source = source.replace(old, new, 1)
E2E.write_text(source)

DOC = Path('docs/dev/stage-verifier-compatibility.md')
DOC.parent.mkdir(parents=True, exist_ok=True)
DOC.write_text('''# 跨阶段 Verifier 与 E2E 兼容规范

本规范适用于所有 Lxx 阶段开发、回归 verifier、Docker E2E 和阶段报告门禁。

## 1. Verifier 检查业务语义，不绑定实现细节

- 检查权限、data scope、事务、幂等、分页和审计等不变量。
- 禁止只检查局部变量名、临时 helper 名、固定代码排版或函数定义在文件中的绝对位置。
- 实现重构后，旧阶段 verifier 应接受语义等价实现，但不得降低安全和业务约束。
- 检查调用顺序时，必须先截取目标函数或路由区块，不能对整个文件直接 `indexOf`。

## 2. Fixture、查询条件与期望结果必须形成显式契约

每个 E2E 场景必须明确记录：

1. fixture 属于哪个 scope；
2. 哪些字段是可搜索字段；
3. 哪些字段只是 CSV 公式注入等安全 fixture；
4. 查询使用哪些筛选条件；
5. 预期命中的具体 ID 集合和数量。

禁止：

- 使用未出现在可搜索字段中的 `runId` 作为 keyword，却断言所有 fixture 都应命中；
- 用 `>= 2` 等魔法数字掩盖 fixture 与查询不一致；
- 将危险 CSV 文本同时假定为普通关键词，除非接口明确支持该字段搜索；
- 先写 success marker，再补真实断言。

分页测试与筛选测试应分开：

- 分页测试使用确定性 scope 和无歧义条件，断言精确 `total`、第一页、第二页和 ID 集合；
- 每种筛选条件单独使用真实可命中的字段验证；
- CSV 安全测试应确保危险 fixture 实际进入导出结果。

## 3. 跨阶段修改的回归要求

当新阶段修改旧阶段已有文件时，开发者必须：

1. 搜索所有旧 verifier 对该文件的引用；
2. 先运行当前阶段 verifier；
3. 再运行被影响的上一阶段 verifier；
4. 最后运行完整 chain；
5. 若旧 verifier 因等价重构失败，应修复 verifier 的语义检查，而不是恢复更差的实现。

## 4. 运行时证据要求

- 静态 verifier 只能证明结构存在，不能替代 API 和数据库运行时检查。
- Docker E2E 必须基于真实 API 响应和 Prisma 状态断言。
- 拒绝、越权和校验失败必须断言无数据库副作用。
- 日志 marker 必须由已经通过的真实变量和断言产生。

## 5. 阶段交付前检查清单

- [ ] fixture-query 期望矩阵已核对；
- [ ] 没有变量名、排版或魔法数量门禁；
- [ ] 修改过的旧模块对应旧 verifier 已运行；
- [ ] 分页、筛选、scope、CSV 和并发分别有独立断言；
- [ ] stage report 与当前 head、merge-base 和真实 diff 一致；
- [ ] 完整 chain 与 report publish verifier 均通过。
''')

PLAN = Path('docs/plans/next-stage-development-plan.md')
plan = PLAN.read_text()
marker = '## 全局：跨阶段 Verifier 兼容规则'
if marker not in plan:
    plan += f'''\n\n{marker}\n\n- 所有阶段开发必须遵循 `docs/dev/stage-verifier-compatibility.md`。\n- 新阶段修改旧模块时，必须审计并运行所有受影响的旧阶段 verifier。\n- verifier 检查业务语义，禁止绑定局部变量名、固定排版和魔法数量。\n- Docker E2E 的 fixture、查询条件、可搜索字段和预期 ID/数量必须形成显式契约。\n'''
    PLAN.write_text(plan)

VERIFY = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verify = VERIFY.read_text()
needle = "assert(!existsSync('apps/admin/src/pages/dashboard-v2'), 'L46 dashboard not added');"
insert = "assert(existsSync('docs/dev/stage-verifier-compatibility.md'), 'global verifier compatibility guidance exists');\n" + needle
if 'global verifier compatibility guidance exists' not in verify:
    if needle not in verify:
        raise SystemExit('missing L45 verifier insertion point')
    verify = verify.replace(needle, insert, 1)
    VERIFY.write_text(verify)
