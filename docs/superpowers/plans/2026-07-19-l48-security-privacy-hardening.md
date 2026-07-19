# L48 Security & Privacy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将所有 `/api/me/**` 与 `/api/leaders/me/**` 统一到 header-only 当前用户安全边界，消除 query/body 身份切换、原始异常泄露、敏感响应字段和日志敏感信息。

**Architecture:** 新建独立的 current-user 安全核心和路由包装器，身份解析只接受 `x-user-id`、`x-openid`，并把公开 4xx 与未知 500 严格分开。现有个人中心、订单、团长提现和奖励转换逐步迁移到该边界；HTTP 日志与业务日志分别由专用隐私模块收口，L48 verifier 自动枚举全部当前用户路由并阻止回退。

**Tech Stack:** TypeScript、Fastify、Prisma、Vitest、pnpm、Docker Compose、现有 stage/report 工具链。

## Global Constraints

- 稳定基线必须是 `stable/l47-business-base@a23401df53cfae1cd41fd47f94c59f3f974d1e60`。
- 工作分支必须是 `work/l48-security-privacy-hardening`。
- 严格 TDD：生产行为改变前必须先提交并实际观察对应 RED。
- 当前用户身份只读取 `x-user-id`、`x-openid`；两者同时存在时 `x-user-id` 优先。
- query/body 中的用户或团长身份字段不得决定数据归属。
- 缺少身份返回 401；用户不存在返回 404；非 active 用户返回 403；非团长访问 `/api/leaders/me/**` 返回 403。
- 只有显式 `PublicCurrentUserError` 的 4xx 文案可以返回客户端；未知异常统一返回固定 500 文案。
- 不得在响应或日志中泄露原始身份标识、联系方式、详细地址、账户信息、人工流水、税务备注、管理员备注、管理员处理人 ID、异常 message 或 stack。
- 金额继续使用整数分。
- 不修改 `package.json`、`pnpm-lock.yaml`、`prisma/schema.prisma`、`prisma/migrations/**`。
- 不实现 JWT/OAuth、微信 session、限流、CORS 重构、数据库加密、数据删除机制或 Admin 权限重写。
- 业务分支不得包含 `reports/**`、`.tmp/**`。
- 不实现 L49+ 功能。
- 最终 PR 不开启 auto-merge。

---

## Planned File Structure

### New API files

- `apps/api/src/modules/current-user/current-user-security.ts`：header-only 身份解析、active/leader 检查、公开错误类型、未知错误映射和安全错误日志元数据。
- `apps/api/src/modules/current-user/current-user-security.test.ts`：安全核心单元测试。
- `apps/api/src/routes/current-user-route.ts`：`withCurrentUser`、`withCurrentLeader` 路由包装器。
- `apps/api/src/routes/current-user-route.test.ts`：包装器响应与异常映射测试。
- `apps/api/src/routes/me/orders-security.test.ts`：订单接口身份与异常回归测试。
- `apps/api/src/routes/leader-dashboard-security.test.ts`：团长看板身份、角色与异常回归测试。
- `apps/api/src/routes/leader-withdrawals-security.test.ts`：团长提现接口身份、DTO 和异常回归测试。
- `apps/api/src/routes/leader-reward-conversion-security.test.ts`：奖励转换归属和隐私回归测试。
- `apps/api/src/services/http-log-privacy.ts`：HTTP request serializer 与安全日志配置。
- `apps/api/src/services/http-log-privacy.test.ts`：query/header/body 不进入请求日志的测试。
- `apps/api/src/services/logging-service-privacy.test.ts`：业务日志 payload/message 与兜底错误日志测试。

### Existing API files to modify

- `apps/api/src/app.ts`：接入安全 HTTP logger。
- `apps/api/src/modules/me-center/me-center-route-security.ts`：改为共享安全核心兼容导出，或在所有引用迁移后删除。
- `apps/api/src/modules/me-center/me-center-routes.test.ts`：补 active 状态并继续验证 L47 边界。
- `apps/api/src/modules/user-orders/user-order-service.ts`：删除 query-capable `resolveUserIdentity`，把已知业务错误改为显式公开错误。
- `apps/api/src/routes/me/center.ts`：使用 `withCurrentUser`。
- `apps/api/src/routes/leaders/center.ts`：使用 `withCurrentLeader`。
- `apps/api/src/routes/group-buys.ts`：只迁移 `/api/leaders/me/dashboard`；公开下单、开团与 Admin 路由保持原边界。
- `apps/api/src/routes/me/orders.ts`：使用 `withCurrentUser`，禁止原始异常回传。
- `apps/api/src/routes/withdrawals.ts`：只迁移 `/api/leaders/me/**` 段；Admin 路由保持原权限模型。
- `apps/api/src/routes/rewards.ts`：奖励转换使用当前团长身份和显式响应 DTO。
- `apps/api/src/services/logging-service.ts`：扩展递归脱敏并安全化兜底日志。

### New verification/report files

- `scripts/l48-security-privacy-contract.ts`：稳定基线、允许路径、禁止响应键、运行 marker。
- `scripts/verify-l48-security-privacy-hardening-local.ts`：自动路由枚举和静态防回退。
- `scripts/run-l48-security-privacy-docker-e2e-local.ts`：隔离 API E2E 启动器。
- `scripts/verify-l48-security-privacy-docker-e2e-local.ts`：确定性 fixture、接口与日志隐私 E2E。
- `scripts/l48-report-evidence-hook.ts`：L48 报告证据注入。
- `scripts/verify-l48-report-routing-local.ts`：报告路由验证。
- `scripts/verify-l48-report-publish-local.ts`：最终报告绑定与严格内容验证。
- `docs/reviews/l48-security-privacy-hardening.md`：人工 reviewer 清单。

### Existing verification/report files to modify

- `scripts/verify-l12-fulfillment-local.ts`：团长看板历史验收改用 `x-user-id`，保持 L12 聚合断言并适配 header-only 边界。
- `scripts/verify-l47-miniapp-profile-leader-center-local.ts`：允许 L47 安全能力迁移到共享 current-user 模块，保持原语义检查。
- `scripts/stage-registry.ts`：注册 L48 和 `stable/l47-business-base` 报告合同。
- `scripts/verify-stage-registry-local.ts`、`scripts/verify-report-source-resolver-local.ts`、`scripts/verify-stage-verifier-architecture-local.ts`：补 L48 回归。
- `scripts/generate-stage-report-entry.ts`、`scripts/publish-stage-report.ts`、`scripts/stage-workflow.ts`：仅在现有通用逻辑无法识别 L48 时做最小扩展。

---

### Task 1: Add the L48 Contract and a Failing Static Security Gate

**Files:**
- Create: `scripts/l48-security-privacy-contract.ts`
- Create: `scripts/verify-l48-security-privacy-hardening-local.ts`

**Interfaces:**
- Produces: `L48_BUSINESS_BASE_BRANCH`, `L48_BUSINESS_BASE_COMMIT`, `L48_PROHIBITED_RESPONSE_KEYS`, `L48_RUNTIME_MARKERS`, `isL48AllowedChangedPath()`。
- Consumes later: Task 9 Docker E2E、Task 10 stage/report 注册。

- [ ] **Step 1: Create the L48 contract**

```ts
export const L48_BUSINESS_BASE_BRANCH = 'stable/l47-business-base';
export const L48_BUSINESS_BASE_COMMIT = 'a23401df53cfae1cd41fd47f94c59f3f974d1e60';

export const L48_PROHIBITED_RESPONSE_KEYS = [
  'openid',
  'unionid',
  'phone',
  'receiver_phone',
  'receiver_address',
  'bank_account',
  'account_number',
  'manual_reference',
  'tax_remark',
  'admin_remark',
  'reviewed_by_admin_id',
  'processed_by_admin_id',
] as const;

export const L48_RUNTIME_MARKERS = [
  'l48_query_only_identity_rejected=true',
  'l48_header_identity_wins=true',
  'l48_inactive_user_forbidden=true',
  'l48_non_leader_forbidden=true',
  'l48_reward_owner_scope_verified=true',
  'l48_withdrawal_owner_scope_verified=true',
  'l48_response_privacy_verified=true',
  'l48_http_log_privacy_verified=true',
  'l48_business_log_privacy_verified=true',
  'l48_unknown_error_sanitized=true',
] as const;
```

Add an allow-list that accepts only the approved API, miniapp compatibility, scripts, L48 docs, and stage/report files. Explicitly reject dependency files, Prisma schema/migrations, `reports/`, and `.tmp/`.

- [ ] **Step 2: Create the static verifier with real route discovery**

Use recursive filesystem traversal under `apps/api/src/routes` and detect literal route registrations matching:

```ts
const currentUserRoutePattern = /['"`]\/api\/(?:me|leaders\/me)(?:\/[^'"`]*)?['"`]/g;
```

For every matching route file, assert:

```ts
assert(
  source.includes('withCurrentUser(') || source.includes('withCurrentLeader('),
  `Current-user route does not use shared wrapper: ${file}`,
);
assert(!source.includes('resolveUserIdentity'), `Legacy identity resolver remains: ${file}`);
assert(!/statusCode\s*\?\?\s*400/.test(source), `Unknown error defaults to 400: ${file}`);
assert(
  !/fail\(error instanceof Error \? error\.message/.test(source),
  `Raw error message is returned: ${file}`,
);
```

The verifier must also assert that `apps/api/src/modules/current-user/current-user-security.ts`, both wrappers, privacy tests, Docker E2E, and all ten markers exist.

- [ ] **Step 3: Run the verifier and confirm RED**

Run:

```bash
pnpm exec tsx scripts/verify-l48-security-privacy-hardening-local.ts
```

Expected: FAIL because the shared current-user module/wrappers do not exist and existing order/withdrawal/reward routes still use legacy patterns.

- [ ] **Step 4: Commit the RED gate**

```bash
git add scripts/l48-security-privacy-contract.ts scripts/verify-l48-security-privacy-hardening-local.ts
git commit -m "test: add failing L48 security privacy gate"
```

---

### Task 2: Build the Shared Header-Only Current-User Security Core

**Files:**
- Create: `apps/api/src/modules/current-user/current-user-security.test.ts`
- Create: `apps/api/src/modules/current-user/current-user-security.ts`

**Interfaces:**
- Produces:
  - `resolveCurrentUser(headers, client?)`
  - `requireCurrentLeader(user)`
  - `publicCurrentUserError(message, statusCode)`
  - `mapCurrentUserRouteError(error, fallbackMessage)`
  - `safeErrorLogMetadata(operation, error)`
  - `CurrentUserIdentity`
- Consumes: Prisma client or transaction-compatible `user.findUnique` implementation.

- [ ] **Step 1: Write the failing core tests**

Test these exact behaviors:

```ts
it('rejects missing or query-only identity inputs with 401', async () => {
  await expect(resolveCurrentUser({}, fakeClient)).rejects.toMatchObject({ statusCode: 401 });
});

it('uses x-user-id before x-openid when both exist', async () => {
  const user = await resolveCurrentUser(
    { 'x-user-id': 'user-a', 'x-openid': 'openid-b' },
    fakeClient,
  );
  expect(user.id).toBe('user-a');
  expect(fakeFindUnique).toHaveBeenCalledWith({ where: { id: 'user-a' }, select: CURRENT_USER_SELECT });
});

it('rejects inactive users with 403', async () => {
  fakeFindUnique.mockResolvedValue({ id: 'user-a', role: 'customer', status: 'inactive' });
  await expect(resolveCurrentUser({ 'x-user-id': 'user-a' }, fakeClient)).rejects.toMatchObject({ statusCode: 403 });
});

it('requires leader role', () => {
  expect(() => requireCurrentLeader({ id: 'u', role: 'customer', status: 'active' } as any))
    .toThrowError('仅开团人可访问');
});

it('maps unknown errors to fixed 500 without exposing the message', () => {
  expect(mapCurrentUserRouteError(new Error('database-host-secret'), '操作失败')).toEqual({
    statusCode: 500,
    message: '操作失败',
  });
});
```

Also assert that `safeErrorLogMetadata('resolve-user', error)` contains only `operation`, `error_name`, and stable `error_code`, not `message` or `stack`.

- [ ] **Step 2: Run the tests and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/modules/current-user/current-user-security.test.ts
```

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Implement the minimal security core**

Use this public error model:

```ts
export class PublicCurrentUserError extends Error {
  readonly exposeToClient = true;

  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = 'PublicCurrentUserError';
  }
}

export function publicCurrentUserError(message: string, statusCode: number) {
  return new PublicCurrentUserError(message, statusCode);
}
```

Use a narrow identity select:

```ts
export const CURRENT_USER_SELECT = {
  id: true,
  openid: true,
  role: true,
  status: true,
  nickname: true,
  avatar_url: true,
} as const;
```

Implement header parsing and resolution:

```ts
export async function resolveCurrentUser(
  headers: Record<string, unknown>,
  client: Pick<typeof prisma, 'user'> = prisma,
): Promise<CurrentUserIdentity> {
  const userId = headerValue(headers['x-user-id']);
  const openid = headerValue(headers['x-openid']);
  if (!userId && !openid) throw publicCurrentUserError('缺少用户身份', 401);

  const user = userId
    ? await client.user.findUnique({ where: { id: userId }, select: CURRENT_USER_SELECT })
    : await client.user.findUnique({ where: { openid: openid! }, select: CURRENT_USER_SELECT });

  if (!user) throw publicCurrentUserError('用户不存在', 404);
  if (user.status !== 'active') throw publicCurrentUserError('用户状态不可用', 403);
  return user;
}
```

`requireCurrentLeader` must throw a public 403. `mapCurrentUserRouteError` must preserve only `PublicCurrentUserError` with integer 400–499 status; every other error maps to 500/fallback. `safeErrorLogMetadata` may read an error `name` and a stable `code` property but never message or stack.

- [ ] **Step 4: Run tests and API typecheck**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/modules/current-user/current-user-security.test.ts
pnpm --filter @community-selection/api typecheck
```

Expected: all core tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/current-user
git commit -m "feat: add shared current user security core"
```

---

### Task 3: Add Shared Route Wrappers and Migrate Both Center Routes

**Files:**
- Create: `apps/api/src/routes/current-user-route.test.ts`
- Create: `apps/api/src/routes/current-user-route.ts`
- Modify: `apps/api/src/routes/me/center.ts`
- Modify: `apps/api/src/routes/leaders/center.ts`
- Modify: `apps/api/src/modules/me-center/me-center-route-security.ts`
- Modify: `apps/api/src/modules/me-center/me-center-routes.test.ts`
- Modify: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Produces:
  - `withCurrentUser(request, reply, fallbackMessage, handler)`
  - `withCurrentLeader(request, reply, fallbackMessage, handler)`
- Consumes: Task 2 security core.

- [ ] **Step 1: Write failing wrapper tests**

Use a real Fastify instance and route injection to verify:

```ts
app.get('/test/me', (request, reply) =>
  withCurrentUser(request, reply, '测试操作失败', async (user) => ({ user_id: user.id })),
);
```

Tests must cover: no header 401, inactive 403, handler unknown error 500/fixed message, and a handler `publicCurrentUserError('输入不合法', 400)` preserving 400/message. For the leader wrapper, customer must receive 403 and a leader must reach the handler.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/current-user-route.test.ts
```

Expected: FAIL because the wrapper module does not exist.

- [ ] **Step 3: Implement wrappers**

```ts
export async function withCurrentUser<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  fallbackMessage: string,
  handler: (user: CurrentUserIdentity) => Promise<T>,
) {
  try {
    const user = await resolveCurrentUser(request.headers);
    return ok(await handler(user));
  } catch (error) {
    const mapped = mapCurrentUserRouteError(error, fallbackMessage);
    if (mapped.statusCode === 500) {
      request.log.error(safeErrorLogMetadata('current-user-route', error), fallbackMessage);
    }
    reply.code(mapped.statusCode);
    return fail(mapped.message);
  }
}
```

`withCurrentLeader` performs `requireCurrentLeader(await resolveCurrentUser(...))` before invoking the handler and uses the same safe error mapping.

- [ ] **Step 4: Migrate center routes**

Personal center becomes:

```ts
app.get('/api/me/center-summary', (request, reply) =>
  withCurrentUser(request, reply, '个人中心加载失败', (user) => getMeCenterSummary(user.id)),
);
```

Leader center becomes:

```ts
app.get('/api/leaders/me/center-summary', (request, reply) =>
  withCurrentLeader(request, reply, '团长中心加载失败', (leader) => getLeaderCenterSummary(leader.id)),
);
```

Convert `me-center-route-security.ts` to compatibility re-exports only, or remove it after confirming no imports remain. Update the L47 verifier so it checks the shared Task 2/3 modules while preserving the L47 requirements: header-only identity, query conflict protection, non-leader 403, and sanitized 500.

- [ ] **Step 5: Run wrapper and L47 regression tests**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/current-user-route.test.ts \
  src/modules/me-center/me-center-routes.test.ts
pnpm exec tsx scripts/verify-l47-miniapp-profile-leader-center-local.ts
pnpm --filter @community-selection/api typecheck
```

Expected: wrapper tests, seven L47 route tests, L47 verifier, and API typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/current-user-route.ts \
  apps/api/src/routes/current-user-route.test.ts \
  apps/api/src/routes/me/center.ts \
  apps/api/src/routes/leaders/center.ts \
  apps/api/src/modules/me-center \
  scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "refactor: migrate center routes to shared identity boundary"
```

---

### Task 4: Migrate All `/api/me/orders/**` Routes

**Files:**
- Create: `apps/api/src/routes/me/orders-security.test.ts`
- Modify: `apps/api/src/routes/me/orders.ts`
- Modify: `apps/api/src/modules/user-orders/user-order-service.ts`

**Interfaces:**
- Consumes: `withCurrentUser`, `publicCurrentUserError`.
- Produces: all order routes use the current header identity and fixed unknown-error responses.

- [ ] **Step 1: Write failing route security tests**

Cover all five registered routes through at least one successful/negative representative call:

```ts
GET /api/me/orders
GET /api/me/orders/:id
GET /api/me/orders/:id/after-sales
POST /api/me/orders/:id/after-sales
GET /api/me/orders/:id/pickup-code
```

Required cases:

1. `?user_id=other-user` without header returns 401.
2. `x-user-id=user-a` plus conflicting query identity still queries orders for `user-a`.
3. inactive header user returns 403 before order lookup.
4. a mocked Prisma connection error returns 500 with `用户订单操作失败` and does not contain the injected error marker.
5. a known missing order returns a public 404.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/me/orders-security.test.ts
```

Expected: query-only currently resolves or reaches a 404, inactive is not checked, and unknown errors currently return 400/raw message.

- [ ] **Step 3: Remove legacy identity parsing from the service**

Delete `QueryLike`, `asString`, and exported `resolveUserIdentity` from `user-order-service.ts`. Convert known errors to explicit public errors, for example:

```ts
if (!order) throw publicCurrentUserError('订单不存在', 404);
if (requestedRefundCents <= 0) throw publicCurrentUserError('退款金额必须大于 0', 400);
```

Do not convert unexpected Prisma errors.

- [ ] **Step 4: Replace the local wrapper in `routes/me/orders.ts`**

Each route must call `withCurrentUser`. Example:

```ts
app.get('/api/me/orders', (request, reply) =>
  withCurrentUser(request, reply, '用户订单操作失败', (user) =>
    listUserOrders(user.id, request.query as UserOrderQuery),
  ),
);
```

Route query types may include filters and pagination only; identity keys must not be represented or consumed.

- [ ] **Step 5: Run focused tests, existing order tests, typecheck, and L48 verifier**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/me/orders-security.test.ts
pnpm --filter @community-selection/api typecheck
pnpm exec tsx scripts/verify-l48-security-privacy-hardening-local.ts
```

Expected: focused tests/typecheck pass; L48 verifier may still fail only on unmigrated withdrawal/reward/logging/E2E requirements.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/me/orders.ts \
  apps/api/src/routes/me/orders-security.test.ts \
  apps/api/src/modules/user-orders/user-order-service.ts
git commit -m "fix: enforce header identity on user order routes"
```

---

### Task 5: Migrate Leader Withdrawal Routes Without Touching Admin Authorization

**Files:**
- Create: `apps/api/src/routes/leader-withdrawals-security.test.ts`
- Modify: `apps/api/src/routes/withdrawals.ts`

**Interfaces:**
- Consumes: `withCurrentLeader`, `publicCurrentUserError`.
- Produces: safe `/api/leaders/me/withdrawals`, `/:id`, `/withdrawable-commissions`, and POST withdrawal routes.

- [ ] **Step 1: Write failing tests for the four leader withdrawal endpoints**

Required cases:

1. query-only identity returns 401.
2. `x-user-id` works even though the old local resolver only supports `x-openid`.
3. customer header returns 403 for every `/api/leaders/me/**` withdrawal route.
4. body `leader_user_id` or `openid` values cannot select another leader.
5. cross-leader withdrawal detail remains 404.
6. unknown Prisma error returns fixed 500, not raw error text.
7. DTO never returns `admin_remark`, raw `manual_reference`, tax remarks, or admin IDs.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/leader-withdrawals-security.test.ts
```

Expected: x-user-id fails under the old local resolver and unknown errors return 400/raw messages.

- [ ] **Step 3: Remove the local `resolveCurrentLeader` and identity body fields**

Delete the local resolver. Keep legacy body fields only if parsing compatibility requires them, but never read them. The handler receives the leader from `withCurrentLeader`:

```ts
app.post('/api/leaders/me/withdrawals', (request, reply) =>
  withCurrentLeader(request, reply, '提交提现申请失败', async (leader) => {
    const body = request.body as WithdrawBody;
    // all queries and writes use leader.id
  }),
);
```

- [ ] **Step 4: Mark known validation/conflict failures as public**

Replace plain validation errors inside the leader segment:

```ts
if (!clientRequestId || clientRequestId.length > 80) {
  throw publicCurrentUserError('client_request_id 必填且长度不能超过 80', 400);
}
if (ids.length === 0) {
  throw publicCurrentUserError('commission_ids 至少选择一条', 400);
}
```

Map ledger mismatch to a fixed public 409 such as `奖励账本待人工复核`; never return the serialized mismatch payload.

- [ ] **Step 5: Tighten the leader DTO**

Export a pure `toLeaderWithdrawalDto`. It may return amount, status, dates, counts, idempotency key, and masked manual reference. It must not return `admin_remark`; for rejected records use a fixed public message:

```ts
rejection_reason: withdrawal.status === 'rejected'
  ? '提现申请未通过，请联系平台'
  : undefined,
```

Do not change Admin DTOs or Admin permission/data-scope behavior.

- [ ] **Step 6: Run focused tests and L44/L45 regressions**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/leader-withdrawals-security.test.ts
pnpm exec tsx scripts/verify-l44-manual-withdrawal-review-local.ts
pnpm exec tsx scripts/verify-l45-manual-tax-review-export-local.ts
pnpm --filter @community-selection/api typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/withdrawals.ts \
  apps/api/src/routes/leader-withdrawals-security.test.ts
git commit -m "fix: secure leader withdrawal identity and responses"
```

---

### Task 6: Secure Leader Reward Conversion and Return an Explicit DTO

**Files:**
- Create: `apps/api/src/routes/leader-reward-conversion-security.test.ts`
- Modify: `apps/api/src/routes/rewards.ts`

**Interfaces:**
- Consumes: `withCurrentLeader`, `publicCurrentUserError`.
- Produces: conversion writes always scoped to current leader and return `RewardConversionDto`.

- [ ] **Step 1: Write failing reward conversion tests**

Set up two leaders and two commissions. Verify:

1. body-only `leader_user_id` without header returns 401.
2. leader A header plus leader B body and leader A commission still writes for leader A.
3. leader A cannot convert leader B commission.
4. customer header returns 403.
5. unknown transaction error returns fixed 500.
6. response omits full `tax_record`, ledger payloads, leader ID, tax/admin remarks, and internal actor IDs.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/leader-reward-conversion-security.test.ts
```

Expected: old route trusts body leader ID and returns raw Prisma records/errors.

- [ ] **Step 3: Migrate the route to `withCurrentLeader`**

All reads/writes must use `leader.id`. Ignore the legacy body identity field. Commission lookup must include current ownership:

```ts
const commission = await tx.commission.findFirst({
  where: { id: commissionId, leader_user_id: leader.id },
});
if (!commission) throw publicCurrentUserError('开团服务奖励不存在', 404);
```

Known validation and idempotency conflicts must use public 400/409 errors; transaction/Prisma errors remain unknown and therefore become 500.

- [ ] **Step 4: Add an explicit response DTO**

Return only:

```ts
type RewardConversionDto = {
  conversion_id: string;
  commission_id: string;
  amount_cents: number;
  status: string;
  tax_status: string;
  consumer_credit_balance_after_cents: number;
  created_at: string;
  idempotent: boolean;
};
```

The DTO must not embed tax records, ledger rows, payload snapshots, leader IDs, or admin/tax notes.

- [ ] **Step 5: Run focused tests, typecheck, and L48 verifier**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/routes/leader-reward-conversion-security.test.ts
pnpm --filter @community-selection/api typecheck
pnpm exec tsx scripts/verify-l48-security-privacy-hardening-local.ts
```

Expected: focused tests/typecheck pass; static verifier may still wait on logging and Docker E2E files.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/rewards.ts \
  apps/api/src/routes/leader-reward-conversion-security.test.ts
git commit -m "fix: scope reward conversion to current leader"
```

---

### Task 7: Remove Query Strings and Sensitive Headers from HTTP Request Logs

**Files:**
- Create: `apps/api/src/services/http-log-privacy.test.ts`
- Create: `apps/api/src/services/http-log-privacy.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Produces: `requestPath(url)`, `serializeHttpRequest(request)`, `HTTP_LOGGER_OPTIONS`.
- Consumes: Fastify logger configuration only; no new dependency.

- [ ] **Step 1: Write failing serializer tests**

```ts
expect(requestPath('/api/me/orders?user_id=unique-user&phone=13900000000'))
  .toBe('/api/me/orders');

expect(serializeHttpRequest({
  method: 'GET',
  url: '/api/me/orders?identity=unique-marker',
  headers: { 'x-user-id': 'unique-marker', authorization: 'unique-marker' },
  body: { phone: '13900000000' },
  id: 'req-1',
  ip: '127.0.0.1',
} as any)).toEqual({
  request_id: 'req-1',
  method: 'GET',
  path: '/api/me/orders',
  remote_address: '127.0.0.1',
});
```

Assert the serialized JSON does not contain the marker, phone, headers, query, or body.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/services/http-log-privacy.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure serializer**

```ts
export function requestPath(url: string): string {
  const index = url.indexOf('?');
  return index >= 0 ? url.slice(0, index) : url;
}

export function serializeHttpRequest(request: FastifyRequest) {
  return {
    request_id: request.id,
    method: request.method,
    path: requestPath(request.url),
    remote_address: request.ip,
  };
}
```

Export logger options with this request serializer and a minimal response serializer containing only status code. Do not serialize headers, body, cookies, session values, or full URL.

- [ ] **Step 4: Configure Fastify**

Replace `Fastify({ logger: true })` with `Fastify({ logger: HTTP_LOGGER_OPTIONS })`. Preserve existing logger enablement and request IDs.

- [ ] **Step 5: Run tests and an app smoke test**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/services/http-log-privacy.test.ts
pnpm --filter @community-selection/api typecheck
```

Expected: pass, with no logger type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/http-log-privacy.ts \
  apps/api/src/services/http-log-privacy.test.ts \
  apps/api/src/app.ts
git commit -m "fix: redact current user request logs"
```

---

### Task 8: Harden Business Log Sanitization and Safe Logging Fallbacks

**Files:**
- Create: `apps/api/src/services/logging-service-privacy.test.ts`
- Modify: `apps/api/src/services/logging-service.ts`

**Interfaces:**
- Produces: stronger `sanitizePayload`, `sanitizeLogText`, `safeLoggingFailureMetadata`.
- Preserves: existing `recordBusinessEvent`, `recordOrderTimeline`, `raiseOpsAlert`, and safe wrapper signatures.

- [ ] **Step 1: Write failing privacy tests**

Create a nested payload containing unique values under identity, phone, address, account, manual reference, tax/admin note, and admin actor keys. Assert none remain after `sanitizePayload`.

Also spy on `console.error`:

```ts
const error = Object.assign(new Error('unique-db-host-secret'), {
  code: 'P9999',
  stack: 'unique-stack-secret',
});
await safeRecordBusinessEvent(failingClient, { event_type: 'x', event_source: 'test' });
const logged = JSON.stringify(consoleErrorSpy.mock.calls);
expect(logged).not.toContain('unique-db-host-secret');
expect(logged).not.toContain('unique-stack-secret');
expect(logged).toContain('P9999');
```

Verify `message`, timeline message, alert title/message, and resolution notes are sanitized before persistence.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/services/logging-service-privacy.test.ts
```

Expected: current safe wrappers log the complete error object and message fields are not sanitized.

- [ ] **Step 3: Extend sensitive key handling**

Add exact or pattern coverage for:

```ts
/manual_reference|tax_remark|admin_remark|reviewed_by_admin_id|processed_by_admin_id|resolved_by/i
```

Use `[FILTERED]` for internal notes/identifiers. Continue masking user-visible phone/name/address values where existing behavior requires them.

- [ ] **Step 4: Sanitize persisted text fields**

Apply `sanitizeLogText` to business event message, timeline message, alert title/message, and resolution notes. The function must filter known sensitive key/value patterns and phone-like values without altering normal operational text.

- [ ] **Step 5: Replace raw fallback logging**

Replace:

```ts
console.error('safeRecordBusinessEvent failed', error);
```

with:

```ts
console.error('safe logging operation failed', safeLoggingFailureMetadata('recordBusinessEvent', error));
```

The metadata object contains only operation, error name, and stable code. Apply the same rule to all three safe wrappers.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/services/logging-service-privacy.test.ts
pnpm --filter @community-selection/api typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/logging-service.ts \
  apps/api/src/services/logging-service-privacy.test.ts
git commit -m "fix: harden business log privacy"
```

---

### Task 9: Add Response Privacy Scanning and Isolated Docker E2E

**Files:**
- Modify: `scripts/l48-security-privacy-contract.ts`
- Create: `scripts/verify-l48-security-privacy-docker-e2e-local.ts`
- Create: `scripts/run-l48-security-privacy-docker-e2e-local.ts`

**Interfaces:**
- Produces: deterministic L48 runtime evidence and ten exact markers.
- Consumes: Task 1 contract and Task 2–8 production behavior.

- [ ] **Step 1: Add recursive response scanning helpers to the contract**

Implement:

```ts
export function findProhibitedResponsePaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => findProhibitedResponsePaths(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    ...(L48_PROHIBITED_RESPONSE_KEYS.includes(key as any) ? [`${path}.${key}`] : []),
    ...findProhibitedResponsePaths(child, `${path}.${key}`),
  ]);
}
```

Allow explicit masked keys only by keeping them out of the prohibited-key list.

- [ ] **Step 2: Build deterministic fixtures**

The E2E creates and later removes:

- active customer A and B;
- inactive customer;
- active leader A and B;
- order owned by customer A;
- available commission owned by leader A and another owned by leader B;
- withdrawal owned by leader A;
- unique privacy marker inserted only in conflicting query/body/header test inputs.

Use a unique run prefix and cleanup in `finally`.

- [ ] **Step 3: Verify identity and ownership boundaries**

Call the real isolated API and assert:

- query-only `/api/me/orders` => 401;
- customer A header + customer B query => only A data;
- inactive header => 403;
- customer header on every discovered `/api/leaders/me/**` endpoint => 403;
- leader A header cannot read leader B withdrawal;
- leader A header cannot convert leader B commission;
- body identity conflict does not switch leader.

- [ ] **Step 4: Verify response privacy and unknown-error evidence**

Scan every success and failure JSON body with `findProhibitedResponsePaths`. The unit tests remain the source of truth for injected Prisma failures; E2E prints `l48_unknown_error_sanitized=true` only after running the focused route test command from the wrapper and observing exit 0.

- [ ] **Step 5: Verify logs**

Capture isolated API stdout/stderr. Send a request whose query/header/body contain a unique marker and phone-like marker. After shutdown, assert captured logs do not contain either marker, query text, raw body, or sensitive headers. Trigger a failing safe business-log write with a unique error marker and assert that marker/stack are absent while stable operation/code metadata exists.

- [ ] **Step 6: Print exactly the ten runtime markers**

Print each `L48_RUNTIME_MARKERS` entry once, then:

```text
L48 security privacy Docker API E2E verification passed.
```

- [ ] **Step 7: Run and fix until GREEN**

```bash
pnpm exec tsx scripts/run-l48-security-privacy-docker-e2e-local.ts
```

Expected: all ten unique markers and final pass line.

- [ ] **Step 8: Commit**

```bash
git add scripts/l48-security-privacy-contract.ts \
  scripts/verify-l48-security-privacy-docker-e2e-local.ts \
  scripts/run-l48-security-privacy-docker-e2e-local.ts
git commit -m "test: add L48 isolated security privacy E2E"
```

---

### Task 10: Register L48 Stage and Strict Report Publication

**Files:**
- Create: `scripts/l48-report-evidence-hook.ts`
- Create: `scripts/verify-l48-report-routing-local.ts`
- Create: `scripts/verify-l48-report-publish-local.ts`
- Create: `docs/reviews/l48-security-privacy-hardening.md`
- Modify: `scripts/stage-registry.ts`
- Modify: `scripts/verify-stage-registry-local.ts`
- Modify: `scripts/verify-report-source-resolver-local.ts`
- Modify: `scripts/verify-stage-verifier-architecture-local.ts`
- Modify only if required: `scripts/generate-stage-report-entry.ts`, `scripts/publish-stage-report.ts`, `scripts/stage-workflow.ts`

**Interfaces:**
- Produces: registered stage `L48`, report source bound to stable L47, strict final publish checks.

- [ ] **Step 1: Write failing stage/report verifier fixtures**

Add expectations that:

```ts
getStageDefinition('L48')?.title === 'Security and Privacy Hardening'
resolveReportSource('L48').businessBaseBranch === 'stable/l47-business-base'
resolveReportSource('L48').businessBaseCommit === 'a23401df53cfae1cd41fd47f94c59f3f974d1e60'
```

Run the existing registry/source tests and confirm RED because L48 is unregistered.

- [ ] **Step 2: Register L48**

Add `REPORT_CONTRACTS.L48` and a stage definition:

```ts
{
  id: 'L48',
  number: 48,
  title: 'Security and Privacy Hardening',
  verifier: 'scripts/verify-l48-security-privacy-hardening-local.ts',
  additionalVerifiers: [
    'scripts/run-l48-security-privacy-docker-e2e-local.ts',
    'scripts/verify-l48-report-routing-local.ts',
  ],
  runtimeMarkers: L48_RUNTIME_MARKERS,
}
```

- [ ] **Step 3: Implement the report evidence hook**

The hook must preserve generic report headings and inject:

- exact stable base and source commit;
- discovered `/api/me/**` and `/api/leaders/me/**` route count/list;
- no DB/schema/migration change;
- identity, error, response, HTTP log, business log evidence rows;
- ten marker table;
- explicit limitation that trusted headers are not full authentication;
- no claim of JWT/OAuth, encryption, rate limiting, auto payout, or automatic tax filing.

- [ ] **Step 4: Implement strict publish verification**

Require:

- report metadata source commit equals current business HEAD;
- stable base commit equals `030d06ae...`;
- all required evidence rows are `passed`;
- all ten markers occur exactly once in verify output;
- no high/medium unresolved risk;
- no prohibited claims or raw sensitive sample values;
- business branch has no reports/temp/forbidden files.

- [ ] **Step 5: Add reviewer documentation**

The reviewer checklist must specifically inspect:

- every discovered current-user route;
- conflict between header and query/body identity;
- inactive/role boundaries;
- 500 message sanitization;
- response DTO keys;
- HTTP/business log unique-marker evidence;
- residual risk for public non-`/me` identity-bearing endpoints;
- the trusted-header limitation.

- [ ] **Step 6: Run stage/report tests**

```bash
pnpm exec tsx scripts/verify-stage-registry-local.ts
pnpm exec tsx scripts/verify-report-source-resolver-local.ts
pnpm exec tsx scripts/verify-stage-verifier-architecture-local.ts
pnpm exec tsx scripts/verify-l48-report-routing-local.ts
pnpm exec tsx scripts/verify-l48-security-privacy-hardening-local.ts
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/stage-registry.ts \
  scripts/verify-stage-registry-local.ts \
  scripts/verify-report-source-resolver-local.ts \
  scripts/verify-stage-verifier-architecture-local.ts \
  scripts/l48-report-evidence-hook.ts \
  scripts/verify-l48-report-routing-local.ts \
  scripts/verify-l48-report-publish-local.ts \
  scripts/generate-stage-report-entry.ts \
  scripts/publish-stage-report.ts \
  scripts/stage-workflow.ts \
  docs/reviews/l48-security-privacy-hardening.md
git commit -m "feat: register L48 security privacy stage"
```

Before committing, omit unchanged generic files from `git add`.

---

### Task 11: Final Verification, Report Publication, Manual Review, and PR

**Files:**
- Modify only when an observed verification failure proves a defect.
- Generate reports only on the `stage-reports` branch through existing tooling.

**Interfaces:**
- Produces: final published L48 evidence bound to the final business HEAD and an open non-auto-merge PR.

- [ ] **Step 1: Confirm clean scope against stable base**

```bash
git diff --name-only stable/l47-business-base...HEAD
```

Assert no dependency file, Prisma schema/migration, `reports/`, `.tmp/`, or L49+ path appears.

- [ ] **Step 2: Run focused API tests**

```bash
pnpm --filter @community-selection/api exec vitest run \
  src/modules/current-user/current-user-security.test.ts \
  src/routes/current-user-route.test.ts \
  src/modules/me-center/me-center-routes.test.ts \
  src/routes/me/orders-security.test.ts \
  src/routes/leader-withdrawals-security.test.ts \
  src/routes/leader-reward-conversion-security.test.ts \
  src/services/http-log-privacy.test.ts \
  src/services/logging-service-privacy.test.ts
```

Expected: all files/tests pass with zero failures.

- [ ] **Step 3: Run typechecks and focused verifiers**

```bash
pnpm --filter @community-selection/api typecheck
pnpm exec tsx scripts/verify-l47-miniapp-profile-leader-center-local.ts
pnpm exec tsx scripts/verify-l48-security-privacy-hardening-local.ts
pnpm exec tsx scripts/run-l48-security-privacy-docker-e2e-local.ts
```

Expected: typecheck exits 0, L47 regression passes, L48 static verifier passes, all ten L48 runtime markers print once.

- [ ] **Step 4: Run full L24–L48 chain and publish**

Do not use a host-level `exit`. Inside the API container:

```bash
pnpm exec tsx scripts/stage-workflow.ts \
  --stage=L48 \
  --publish \
  --scope=chain \
  --push
```

Expected evidence includes:

```text
verification_source_commit:<FINAL_L48_HEAD>
command_completed:L48 verifier=true
command_completed:L48 security privacy Docker E2E=true
command_completed:L24-L48 chain regression=true
command_completed:Docker API E2E=true
command_completed:Admin typecheck=true
command_completed:raw compliance scan=true
command_completed:Stage workflow=true
Report publish verification passed.
command_completed:report:publish L48=true
```

- [ ] **Step 5: Verify published report binding**

Read `stage-reports/reports/L48/latest.json`, `latest.md`, and `latest-verify-output.txt`. Confirm source commit equals the final business HEAD and all required evidence/markers passed.

- [ ] **Step 6: Perform manual code review**

Compare:

```text
stable/l47-business-base...work/l48-security-privacy-hardening
```

Review Critical/Important issues before PR creation. Specifically re-check route inventory, header-only ownership, inactive/leader boundaries, unknown 500 behavior, DTO keys, request logs, safe business logs, and the trusted-header limitation.

- [ ] **Step 7: Create the final PR without merging**

Use:

- Base: `stable/l47-business-base`
- Head: `work/l48-security-privacy-hardening`
- Title: `Harden current-user identity and privacy boundaries`
- Draft: false
- Auto-merge: disabled

PR body must list exact final source commit, published report evidence, scope exclusions, residual trusted-header/public non-`/me` risks, and all observed verification results.

- [ ] **Step 8: Re-fetch PR state**

Confirm the PR head has not moved, base is correct, changed files are in scope, and GitHub reports it mergeable or still calculating. Do not merge without a later explicit user request.
