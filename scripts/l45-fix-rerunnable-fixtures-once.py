from pathlib import Path

branch_file = Path('scripts/verify-docker-api-e2e-local.ts')
source = branch_file.read_text()
old_run = "  const runId = `l45-${Date.now()}`;"
new_run = "  const runId = `l45-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;"
if old_run not in source:
    raise SystemExit('L45 runId marker not found')
source = source.replace(old_run, new_run, 1)
old_client = "client_request_id: suffix === 'danger-a' ? '\\tclient-danger' : `${runId}-${suffix}-withdrawal`"
new_client = "client_request_id: suffix === 'danger-a' ? `\\tclient-danger-${runId}` : `${runId}-${suffix}-withdrawal`"
if old_client not in source:
    raise SystemExit('fixed danger client_request_id marker not found')
source = source.replace(old_client, new_client, 1)
branch_file.write_text(source)

verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
anchor = "assert(!e2e.includes('await fetch(`${API_BASE_URL}'), 'Docker E2E API calls must go through fetchOrThrow for diagnostics');"
addition = """
assert(e2e.includes("const runId = `l45-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`"), 'L45 E2E run token must be unique across reruns and concurrent processes');
assert(e2e.includes("suffix === 'danger-a' ? `\\tclient-danger-${runId}`"), 'L45 dangerous unique client_request_id fixture must include the run token');
assert(!e2e.includes("suffix === 'danger-a' ? '\\tclient-danger'"), 'L45 unique fields must not use fixed dangerous fixture values');
""".strip()
if anchor not in verifier:
    raise SystemExit('L45 verifier diagnostics anchor not found')
if addition not in verifier:
    verifier = verifier.replace(anchor, anchor + '\n' + addition, 1)
verifier_path.write_text(verifier)

doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = """

## 7. E2E 可重跑与唯一字段规范

- 每次 E2E 运行必须生成独立 run token；token 至少组合时间、进程标识和随机片段，或使用等价的 UUID。
- 所有带唯一约束的 fixture 字段都必须包含 run token，例如 `openid`、`order_no`、`client_request_id`、外部流水号和幂等键。
- 安全测试需要以制表符、`=`、`+`、`-`、`@` 等危险字符开头时，必须保留危险前缀并在后面拼接 run token，禁止把固定危险值直接写入唯一字段。
- 上一次运行中断或失败后留下的数据，不得阻塞下一次运行；E2E 必须能够直接重跑。
- 并发执行两个 E2E 进程时，fixture 不得发生唯一键碰撞。
- 可以增加 best-effort cleanup，但 cleanup 不能成为可重跑的唯一保障；核心保障必须是每次运行的唯一命名空间。
- 出现唯一约束错误时，应先检查 fixture 唯一性契约，不得删除业务唯一索引或降低数据库约束来让测试通过。
"""
if '## 7. E2E 可重跑与唯一字段规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_anchor = '- Docker E2E 的 fixture、查询条件、可搜索字段和预期 ID/数量必须形成显式契约。'
plan_line = '- Docker E2E 的所有唯一字段 fixture 必须包含每次运行唯一的 run token，确保失败后可重跑且并发执行不碰撞。'
if plan_anchor not in plan:
    raise SystemExit('global plan verifier rule anchor not found')
if plan_line not in plan:
    plan = plan.replace(plan_anchor, plan_anchor + '\n' + plan_line, 1)
plan_path.write_text(plan)
