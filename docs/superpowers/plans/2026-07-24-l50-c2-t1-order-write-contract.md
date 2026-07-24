# L50-C2-T1 Order Write Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Admin order status changes behind an authenticated, scoped, versioned and idempotent V1 command boundary while retiring unauthenticated order read/write routes.

**Architecture:** Add an additive order version and Admin command-receipt table, then implement a focused command service that owns validation, hashing, conditional update, receipt replay and all transactional side effects. The Fastify Admin route performs V1 authentication/permission checks and current data-scope authorization; the React Admin client sends the visible version and one UUID per command. Existing consumer order creation and `/api/me/orders*` remain unchanged.

**Tech Stack:** Node.js 20.19, TypeScript, Fastify 5, Prisma 6.19, PostgreSQL, React 18, Vitest, Playwright, pnpm 9.15.

## Global Constraints

- Base branch is `stable/l50-a3-4-business-base`; implementation branch is `codex/l50-c2-t1-order-write-contract`.
- Preserve `POST /api/orders`, `POST /api/orders/normal`, `/api/me/orders*`, and protected Admin reads.
- Retire public order list, detail, picking export, status and complete routes; each must return 404.
- Require Admin identity, `order.manage`, and current order data scope for status commands.
- Require `expected_version >= 1` and a 16–128 printable ASCII `idempotency_key` without surrounding whitespace.
- Same Admin/key/same command replays the saved result; same Admin/key/different command returns 409.
- Order update, version increment, event, Admin audit, timeline, completion reward side effect, and receipt completion commit in one PostgreSQL transaction.
- No POS, outbox/inbox, refund, withdrawal, inventory-write, Redis, MQ, dependency, or lockfile expansion.
- E2E fixtures explicitly create a paid order and never rely on existing database rows.
- Runner limits remain one workspace at a time, Vitest 1–2 workers, and a 3 GiB Node heap.

---

### Task 1: RED Contract Evidence

**Files:**
- Create: `apps/api/src/routes/admin/order-status-contract.test.ts`
- Modify: `apps/admin/src/features/sales/orders/api.test.ts`
- Create: `scripts/admin-e2e/l50-c2-order-source-contract.test.cjs`

**Interfaces:**
- Consumes: current public `/api/orders/:id/status`, unversioned `AdminOrderListItem`, and schema.
- Produces: failing evidence for the new endpoint, body, schema, and retired routes.

- [ ] **Step 1: Add the failing Admin client expectation**

```ts
await updateOrderStatus('o1', 'ready', 3, 'idem-123456789012', request);
expect(request).toHaveBeenCalledWith('/api/admin/orders/o1/status', {
  method: 'POST',
  body: JSON.stringify({
    next_status: 'ready',
    expected_version: 3,
    idempotency_key: 'idem-123456789012',
  }),
});
```

- [ ] **Step 2: Add source/schema retirement assertions**

```js
assert.match(schema, /version\s+Int\s+@default\(1\)/);
assert.match(schema, /model AdminCommandReceipt/);
assert.doesNotMatch(groupBuys, /app\.get\('\/api\/orders'/);
assert.doesNotMatch(groupBuys, /app\.post\('\/api\/orders\/:id\/(status|complete)'/);
assert.match(adminOrders, /'\/api\/admin\/orders\/:id\/status'/);
```

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/sales/orders/api.test.ts
node --test scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
```

Expected: FAIL because the client still uses `/api/orders/:id/status`, `Order.version` and `AdminCommandReceipt` do not exist, and the old routes are still registered.

- [ ] **Step 4: Commit RED evidence**

```bash
git add apps/admin/src/features/sales/orders/api.test.ts scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
git commit -m "test(order): define C2 reliable write contract"
```

### Task 2: Additive Order Version and Command Receipt

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202607240001_l50_c2_order_write_contract/migration.sql`

**Interfaces:**
- Produces: `Order.version: number`; `AdminCommandReceipt` unique on `(admin_user_id, idempotency_key)`.

- [ ] **Step 1: Extend Prisma schema**

```prisma
model Order {
  version Int @default(1)
}

model AdminCommandReceipt {
  id                   String    @id @default(cuid())
  admin_user_id        String
  idempotency_key      String
  operation            String
  target_id            String
  request_hash         String
  response_http_status Int?
  response_code        String?
  response_data        Json?
  completed_at         DateTime?
  created_at           DateTime  @default(now())

  @@unique([admin_user_id, idempotency_key])
  @@index([operation, target_id])
  @@index([created_at])
}
```

- [ ] **Step 2: Add additive SQL**

```sql
ALTER TABLE "Order"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AdminCommandReceipt" (
  "id" TEXT NOT NULL,
  "admin_user_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_http_status" INTEGER,
  "response_code" TEXT,
  "response_data" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminCommandReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminCommandReceipt_admin_user_id_idempotency_key_key"
ON "AdminCommandReceipt"("admin_user_id", "idempotency_key");
CREATE INDEX "AdminCommandReceipt_operation_target_id_idx"
ON "AdminCommandReceipt"("operation", "target_id");
CREATE INDEX "AdminCommandReceipt_created_at_idx"
ON "AdminCommandReceipt"("created_at");
```

- [ ] **Step 3: Generate and validate**

Run:

```bash
pnpm db:generate
pnpm migrations:check
```

Expected: Prisma generation succeeds and the migration checker reports no schema drift.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/202607240001_l50_c2_order_write_contract/migration.sql
git commit -m "feat(order): add versioned command receipts"
```

### Task 3: Command Parser and Transaction Service

**Files:**
- Create: `apps/api/src/modules/order/admin-order-status-command.ts`
- Create: `apps/api/src/modules/order/admin-order-status-command.test.ts`
- Modify: `apps/api/src/routes/admin/order-list-query.ts`
- Modify: `apps/api/src/routes/admin/order-list-query.test.ts`

**Interfaces:**
- Produces: `parseAdminOrderStatusCommand(body)`, `executeAdminOrderStatusCommand(input)`, `AdminOrderCommandError`.
- Consumes: `AdminAccessContext`, `canAccessOrderDataScope`, Prisma transaction APIs, existing audit/event/timeline and reward functions.

- [ ] **Step 1: Write parser failures**

```ts
expect(parseAdminOrderStatusCommand({
  next_status: 'ready',
  expected_version: 0,
  idempotency_key: 'short',
})).toEqual({
  ok: false,
  code: 'INVALID_ADMIN_ORDER_STATUS_COMMAND',
});
```

- [ ] **Step 2: Verify parser RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/order/admin-order-status-command.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement canonical command parsing and hashing**

```ts
const ALLOWED = new Set(['preparing', 'ready', 'picked', 'delivered', 'completed']);
const IDEMPOTENCY = /^[\x21-\x7e]{16,128}$/;

export function commandHash(input: ParsedCommand & { order_id: string }) {
  return createHash('sha256')
    .update(JSON.stringify({
      operation: 'admin.order.status.update.v1',
      target_id: input.order_id,
      next_status: input.next_status,
      expected_version: input.expected_version,
    }))
    .digest('hex');
}
```

- [ ] **Step 4: Write real PostgreSQL behavior tests**

Cover:

```ts
it('allows only one command for the same expected version');
it('replays the same receipt without duplicate event, audit or timeline rows');
it('rejects a reused key with a different digest');
it('rolls back order, receipt and logs when completion side effects fail');
it('reauthorizes data scope before returning a historical receipt');
```

- [ ] **Step 5: Verify transactional tests RED**

Run the focused test against a migrated PostgreSQL database. Expected: FAIL because no execution service exists.

- [ ] **Step 6: Implement one-transaction command**

Use:

```ts
const changed = await tx.order.updateMany({
  where: { id: orderId, version: expectedVersion },
  data: {
    order_status: nextStatus,
    version: { increment: 1 },
    completed_at: nextStatus === 'completed' ? new Date() : undefined,
  },
});
if (changed.count !== 1) {
  throw new AdminOrderCommandError(409, 'ADMIN_ORDER_VERSION_CONFLICT', '订单已被其他操作更新，请刷新后重试');
}
```

Create the receipt placeholder before the conditional update; complete its response fields before commit. On Prisma `P2002`, leave the aborted transaction and read the committed receipt outside it. Before replay, reload the target order and reapply `canAccessOrderDataScope`.

- [ ] **Step 7: Add version to list and detail DTOs**

```ts
type AdminOrderListRecord = { version: number };
const versionField = { version: order.version };
```

Insert `version: order.version` immediately after `id: order.id` in the existing `toAdminOrderListItem()` return object, and insert `version: order.version` immediately after `order_id: order.id` in the existing Admin detail DTO.

- [ ] **Step 8: Run GREEN and commit**

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/order/admin-order-status-command.test.ts \
  src/routes/admin/order-list-query.test.ts
git add apps/api/src/modules/order apps/api/src/routes/admin/order-list-query.ts apps/api/src/routes/admin/order-list-query.test.ts
git commit -m "feat(order): execute idempotent versioned status commands"
```

### Task 4: V1 Admin Route, Authentication and Permission Guard

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/admin-access/admin-access-control.ts`
- Modify: `apps/api/src/routes/admin/orders.ts`
- Create: `apps/api/src/routes/admin/order-status-route.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/orders/:id/status`.
- Consumes: `requireAdminPermissionV1('order.manage')`, parser and command service.

- [ ] **Step 1: Write route-level 400/401/403/404/409 tests**

Assert complete V1 envelopes:

```ts
expect(response.json()).toEqual({
  success: false,
  data: null,
  code: 'ADMIN_ORDER_VERSION_CONFLICT',
  message: '订单已被其他操作更新，请刷新后重试',
  trace_id: expect.any(String),
});
```

- [ ] **Step 2: Verify route RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/routes/admin/order-status-route.test.ts
```

Expected: FAIL with route not found or legacy envelope.

- [ ] **Step 3: Add opt-in V1 authentication**

```ts
const v1 = (request.routeOptions.config as { adminContractV1?: boolean }).adminContractV1 === true;
if (v1) {
  reply.code(401).send(contractFail({
    code: 'ADMIN_UNAUTHORIZED',
    message: '管理员身份无效',
    traceId: String(request.id),
  }));
  return;
}
```

- [ ] **Step 4: Add V1 permission guard**

`requireAdminPermissionV1()` must check active `AdminUser`, required permissions, and emit `ADMIN_UNAUTHORIZED` or `ADMIN_FORBIDDEN` through `contractFail`.

- [ ] **Step 5: Register the command route**

```ts
app.post('/api/admin/orders/:id/status', {
  config: { adminContractV1: true },
  preHandler: requireAdminPermissionV1('order.manage'),
}, async (request, reply) => {
  // parse, execute, map typed errors, log only sanitized metadata
});
```

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm --filter @community-selection/api test -- src/routes/admin/order-status-route.test.ts
git add apps/api/src/app.ts apps/api/src/modules/admin-access/admin-access-control.ts apps/api/src/routes/admin/orders.ts apps/api/src/routes/admin/order-status-route.test.ts
git commit -m "feat(api): protect Admin order status command"
```

### Task 5: Retire Public Routes and Scope Export/Pickup

**Files:**
- Modify: `apps/api/src/routes/group-buys.ts`
- Modify: `apps/api/src/routes/fulfillment.ts`
- Modify: `scripts/admin-e2e/l50-c2-order-source-contract.test.cjs`

**Interfaces:**
- Produces: public retired routes return 404; Admin picking export requires `order.view` and scoped where; legacy pickup verify requires `pickup.verify` and order scope.

- [ ] **Step 1: Remove only retired public handlers**

Delete registrations for:

```text
GET /api/orders
GET /api/orders/:id
GET /api/orders/export/picking.csv
POST /api/orders/:id/status
POST /api/orders/:id/complete
```

Keep the two consumer POST creation routes unchanged.

- [ ] **Step 2: Scope Admin picking export**

Add `preHandler: requireAdminPermission('order.view')`; resolve current context; require non-null `getScopedOrderWhere(context)`; include it in the Prisma `AND` query.

- [ ] **Step 3: Protect legacy pickup verify**

Add `preHandler: requireAdminPermission('pickup.verify')`; load the order; reject missing order and `canAccessOrderDataScope(context, order) === false` before calling `pickupVerify`.

- [ ] **Step 4: Run source and route tests**

```bash
node --test scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
pnpm --filter @community-selection/api test
```

Expected: retired routes are absent and protected replacements remain.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/group-buys.ts apps/api/src/routes/fulfillment.ts scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
git commit -m "fix(api): close legacy order access paths"
```

### Task 6: Admin Client Version and Conflict UX

**Files:**
- Modify: `apps/admin/src/features/sales/orders/types.ts`
- Modify: `apps/admin/src/features/sales/orders/api.ts`
- Modify: `apps/admin/src/features/sales/orders/api.test.ts`
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`

**Interfaces:**
- `updateOrderStatus(orderId, nextStatus, expectedVersion, idempotencyKey, request?)`.
- `AdminOrderListItem.version: number`.

- [ ] **Step 1: Add the visible version**

```ts
export type AdminOrderListItem = {
  id: string;
  version: number;
  order_no: string;
};
```

The snippet shows the exact insertion point: retain the already-defined fields following `order_no`.

- [ ] **Step 2: Implement the new request**

```ts
return request<AdminOrderStatusResult>(`/api/admin/orders/${orderId}/status`, {
  method: 'POST',
  body: JSON.stringify({
    next_status: nextStatus,
    expected_version: expectedVersion,
    idempotency_key: idempotencyKey,
  }),
});
```

- [ ] **Step 3: Generate one key per click**

```ts
await updateOrderStatus(order.id, nextStatus, order.version, crypto.randomUUID());
```

Catch `AdminApiError` with status 409 and show `订单已被其他操作更新，请刷新后重试`; always keep server data as source of truth.

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @community-selection/admin test -- src/features/sales/orders/api.test.ts
pnpm --filter @community-selection/admin typecheck
git add apps/admin/src/features/sales/orders
git commit -m "feat(admin): send versioned order status commands"
```

### Task 7: Explicit PostgreSQL and Playwright Evidence

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`
- Create: `.github/workflows/l50-c2-t1-gate.yml`

**Interfaces:**
- Produces: deterministic paid-order fixture, browser mutation capture, stale-version 409, and cleanup.

- [ ] **Step 1: Create a real paid order fixture**

Create user/product/store/community/order rows inside the E2E setup with a unique `GITHUB_RUN_ID` suffix. Set:

```js
pay_status: 'paid',
order_status: 'paid',
version: 1,
pickup_type: 'store',
```

- [ ] **Step 2: Exercise the browser flow**

Capture the request to `/api/admin/orders/:id/status`; assert `expected_version === 1` and a 16–128 printable ASCII idempotency key. Assert response code `ADMIN_ORDER_STATUS_UPDATED`, then reload and see version 2.

- [ ] **Step 3: Exercise stale write**

Send a second command with `expected_version: 1`; assert HTTP 409, code `ADMIN_ORDER_VERSION_CONFLICT`, and no second event/audit/timeline/reward side effect.

- [ ] **Step 4: Add bounded Runner gate**

Run:

```text
pnpm install --frozen-lockfile
pnpm db:generate
focused C2 contracts
pnpm lint
bounded pnpm -r typecheck
bounded pnpm -r test
pnpm build
Admin auth runtime
source and cleanup contracts
pnpm setup:admin:e2e
pnpm e2e:admin
always cleanup Docker resources
```

- [ ] **Step 5: Commit and run**

```bash
git add scripts/admin-e2e .github/workflows/l50-c2-t1-gate.yml
git commit -m "test(order): verify C2 command on PostgreSQL and browser"
```

Expected: the final head passes every gate on `home-community-runner`.

### Task 8: Final Review, Workflow Cleanup and Merge

**Files:**
- Delete: `.github/workflows/l50-c2-t1-gate.yml`
- Verify: all files changed from `stable/l50-a3-4-business-base`.

- [ ] **Step 1: Run fresh final verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Require the latest remote head’s PostgreSQL + Playwright run to be green.

- [ ] **Step 2: Review requirements and security**

Inspect the complete base-to-head diff for unauthenticated paths, data-scope bypass, replay authorization, raw database messages, incomplete receipts, duplicate side effects, migration rollback risk, and accidental POS/outbox scope.

- [ ] **Step 3: Remove the temporary workflow**

```bash
git rm .github/workflows/l50-c2-t1-gate.yml
git commit -m "ci: remove temporary L50 C2 T1 gate"
```

- [ ] **Step 4: Lock and merge**

Confirm no unresolved review threads, exact final head SHA, mergeability, and successful final tested implementation blobs. Mark Ready and squash merge into `stable/l50-a3-4-business-base`.
