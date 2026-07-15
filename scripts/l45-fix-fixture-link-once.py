from pathlib import Path

# Keep L45 withdrawal fixtures consistent across the direct Commission FK and
# the WithdrawalCommission join table. Production mark-paid validates both.
e2e_path = Path('scripts/verify-docker-api-e2e-local.ts')
e2e = e2e_path.read_text()
helper_start = e2e.index("  async function createWithdrawalFixture(")
helper_end = e2e.index("  const fixtureA =", helper_start)
helper = e2e[helper_start:helper_end]
link_line = "    await prisma.commission.update({ where: { id: commission.id }, data: { withdrawal_id: withdrawal.id } });\n"
join_marker = "    await prisma.withdrawalCommission.create"
if link_line not in helper:
    join_index = e2e.index(join_marker, helper_start, helper_end)
    e2e = e2e[:join_index] + link_line + e2e[join_index:]

old_return = "    return { withdrawal, taxRecord, order, community };"
new_return = "    return { withdrawal, taxRecord, order, community, commission };"
if old_return in e2e:
    e2e = e2e.replace(old_return, new_return, 1)
elif new_return not in e2e:
    raise SystemExit('L45 fixture return shape not found')

fixture_anchor = "  const fixtureE = await createWithdrawalFixture('a', 'none-mark-paid', 1400);\n"
fixture_assert = "  const fixtureELinkedCommission = await prisma.commission.findUniqueOrThrow({ where: { id: fixtureE.commission.id } });\n  assert(fixtureELinkedCommission.status === 'withdrawing' && fixtureELinkedCommission.withdrawal_id === fixtureE.withdrawal.id, 'L45 mark-paid fixture must persist both Commission.withdrawal_id and WithdrawalCommission linkage');\n"
if fixture_anchor not in e2e:
    raise SystemExit('L45 none mark-paid fixture anchor not found')
if fixture_assert not in e2e:
    e2e = e2e.replace(fixture_anchor, fixture_anchor + fixture_assert, 1)
e2e_path.write_text(e2e)

# Static verifier: require both representations of the withdrawal/commission link.
verifier_path = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
verifier = verifier_path.read_text()
anchor = "assert(route.includes('Object.hasOwn') && route.includes('hasReviewRequest'), 'idempotency history must use Object.hasOwn for key lookup');"
addition = """
const l45FixtureStart = e2e.indexOf('async function createWithdrawalFixture');
const l45FixtureEnd = e2e.indexOf('const fixtureA =', l45FixtureStart);
assert(l45FixtureStart >= 0 && l45FixtureEnd > l45FixtureStart, 'L45 withdrawal fixture helper must exist');
const l45FixtureBlock = e2e.slice(l45FixtureStart, l45FixtureEnd);
assert(l45FixtureBlock.includes('prisma.commission.update') && l45FixtureBlock.includes('withdrawal_id: withdrawal.id') && l45FixtureBlock.includes('prisma.withdrawalCommission.create'), 'L45 withdrawal fixture must populate both Commission.withdrawal_id and WithdrawalCommission');
assert(e2e.includes('fixtureELinkedCommission.status === \'withdrawing\'') && e2e.includes('fixtureELinkedCommission.withdrawal_id === fixtureE.withdrawal.id'), 'L45 mark-paid scenario must verify coherent fixture linkage before calling mark-paid');
""".strip()
if anchor not in verifier:
    raise SystemExit('L45 verifier anchor not found')
if addition not in verifier:
    verifier = verifier.replace(anchor, anchor + '\n' + addition, 1)
verifier_path.write_text(verifier)

# Global governance: fixtures must populate every relationship representation
# used by production transition predicates.
doc_path = Path('docs/dev/stage-verifier-compatibility.md')
doc = doc_path.read_text()
section = """

## 14. 多重关联字段 Fixture 一致性规范

- 当同一业务关系同时由直接外键和关联表表达时，E2E fixture 必须同步写入两种表示，不能只构造查询侧能看到的一半数据。
- 若生产状态迁移同时校验 `Commission.withdrawal_id`、`Commission.status` 与 `WithdrawalCommission`，fixture 必须在调用迁移前断言三者一致。
- 测试出现“关联状态已变化”时，应先核对 fixture 是否满足生产 where 条件，不得放宽生产并发或状态守卫来迎合不完整 fixture。
- 静态 verifier 应检查关系构造语义；Docker E2E 应在关键状态迁移前输出或断言真实数据库关系。
"""
if '## 14. 多重关联字段 Fixture 一致性规范' not in doc:
    doc = doc.rstrip() + section + '\n'
doc_path.write_text(doc)

plan_path = Path('docs/plans/next-stage-development-plan.md')
plan = plan_path.read_text()
plan_line = '- 同一业务关系同时使用直接外键与关联表时，E2E fixture 必须同步写入并在状态迁移前断言一致；不得通过放宽生产守卫修复不完整 fixture。'
if plan_line not in plan:
    plan = plan.rstrip() + '\n' + plan_line + '\n'
plan_path.write_text(plan)
