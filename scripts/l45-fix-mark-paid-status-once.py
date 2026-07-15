from pathlib import Path

ROUTE = Path('apps/api/src/routes/withdrawals.ts')
E2E = Path('scripts/verify-docker-api-e2e-local.ts')
VERIFIER = Path('scripts/verify-l45-manual-tax-review-export-local.ts')
GUIDE = Path('docs/dev/stage-verifier-compatibility.md')
SELF = Path('scripts/l45-fix-mark-paid-status-once.py')
WORKFLOW = Path('.github/workflows/l45-mark-paid-status-once.yml')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


route = ROUTE.read_text()
helper_anchor = 'function httpError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }\n'
helper = '''function httpError(message: string, statusCode: number) { return Object.assign(new Error(message), { statusCode }); }

function restoreMarkPaidTransactionError(error: unknown) {
  const message = error instanceof Error ? error.message : "标记提现处理失败";
  const statusCode = (error as { statusCode?: number })?.statusCode;
  if (statusCode) return { message, statusCode };
  if (message === "ADMIN_UNAUTHORIZED: Admin identity required") return { message, statusCode: 401 };
  if (message === ADMIN_SCOPE_FORBIDDEN) return { message, statusCode: 403 };
  if (message === "提现申请不存在") return { message, statusCode: 404 };
  const conflictMessages = new Set([
    "仅审核通过的提现申请可标记已处理",
    "提现税务状态未完成或未计算，不能标记已处理",
    "可处理金额不能小于 0",
    "发票状态未确认，不能标记已处理",
    "提现状态已变化，请刷新后重试",
    "提现关联奖励状态已变化，请人工复核",
  ]);
  return { message, statusCode: conflictMessages.has(message) ? 409 : 400 };
}
'''
if 'function restoreMarkPaidTransactionError(' not in route:
    route = replace_once(route, helper_anchor, helper, 'insert mark-paid transaction error restorer')

route_start = route.index('  app.post(\n    "/api/admin/withdrawals/:id/mark-paid",')
route_end = route.index('\n  );}', route_start)
mark_block = route[route_start:route_end]
old_catch = '''      } catch (error) {
        reply.code((error as { statusCode?: number }).statusCode ?? 400);
        return fail(error instanceof Error ? error.message : "标记提现处理失败");
      }'''
new_catch = '''      } catch (error) {
        const restored = restoreMarkPaidTransactionError(error);
        reply.code(restored.statusCode);
        return fail(restored.message);
      }'''
mark_block = replace_once(mark_block, old_catch, new_catch, 'replace mark-paid outer catch')
route = route[:route_start] + mark_block + route[route_end:]
ROUTE.write_text(route)

e2e = E2E.read_text()
old_pending = "  await request<ErrorApiResponse>(markPaidContract.method, `${markPaidContract.path.replace(':id', markPending.withdrawal.id)}`, { label: 'POST mark-paid L45 tax pending conflict', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { manual_reference: `${runId}-pending-tax` } });"
new_pending = "  const taxPendingConflict = await request<ErrorApiResponse>(markPaidContract.method, `${markPaidContract.path.replace(':id', markPending.withdrawal.id)}`, { label: 'POST mark-paid L45 tax pending conflict', headers: { ...financeAHeaders, 'content-type': 'application/json' }, expectedStatus: 409, body: { manual_reference: `${runId}-pending-tax` } });\n  assert(taxPendingConflict.message === '提现税务状态未完成或未计算，不能标记已处理', 'L45 mark-paid tax pending conflict must preserve the exact 409 business error');"
if 'const taxPendingConflict = await request<ErrorApiResponse>' not in e2e:
    e2e = replace_once(e2e, old_pending, new_pending, 'strengthen mark-paid tax pending E2E')
E2E.write_text(e2e)

verifier = VERIFIER.read_text()
verifier_anchor = "assert(route.includes('提现税务状态未完成或未计算，不能标记已处理\", 409') && route.includes('发票状态未确认，不能标记已处理\", 409'), 'mark-paid state conflicts must use 409');\n"
verifier_extra = verifier_anchor + "assert(route.includes('function restoreMarkPaidTransactionError(') && route.includes('conflictMessages.has(message) ? 409 : 400') && route.includes('const restored = restoreMarkPaidTransactionError(error)') && route.includes('reply.code(restored.statusCode)'), 'mark-paid must restore HTTP status after Prisma transaction error wrapping');\nassert(e2e.includes(\"const taxPendingConflict = await request<ErrorApiResponse>\") && e2e.includes(\"taxPendingConflict.message === '提现税务状态未完成或未计算，不能标记已处理'\"), 'mark-paid tax pending E2E must assert exact 409 message');\n"
if 'mark-paid must restore HTTP status after Prisma transaction error wrapping' not in verifier:
    verifier = replace_once(verifier, verifier_anchor, verifier_extra, 'add mark-paid status propagation verifier')
VERIFIER.write_text(verifier)

guide = GUIDE.read_text()
section = '''

## 13. ORM 事务错误与 HTTP 状态传播规范

- Prisma 等 ORM 的交互事务可能重新包装回调内抛出的错误；业务代码不得假设自定义 `statusCode`、`code` 或其他扩展属性一定原样保留到路由外层。
- 事务内必须保留权限、状态和并发复核，禁止为了获得正确 HTTP 状态码把关键检查全部移到事务外，造成 TOCTOU 竞态。
- 路由边界应对已知业务错误做精确状态恢复：认证为 401、data scope 为 403、不存在为 404、合法请求与资源状态冲突为 409；未知错误继续使用安全的通用失败状态。
- 状态恢复必须基于受控错误类型或精确业务消息集合，不得使用宽泛关键词把未知数据库错误误判为 409。
- Docker E2E 必须同时断言 HTTP 状态、精确业务消息和数据库无副作用，避免“消息正确但状态码回退为 400”的伪通过。
'''
if '## 13. ORM 事务错误与 HTTP 状态传播规范' not in guide:
    marker = '\n\nL45 final review markers:'
    if marker in guide:
        guide = guide.replace(marker, section + marker, 1)
    else:
        guide += section
GUIDE.write_text(guide)

# One-shot cleanup: the resulting branch must contain only formal source/test/docs changes.
for path in (SELF, WORKFLOW):
    if path.exists():
        path.unlink()
