# L50-C2-T2 Pickup Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `picked` reachable only through one authenticated, scoped, versioned, idempotent and atomic Admin pickup-verification command for store-pickup orders currently in `ready`.

**Architecture:** Add a focused parser/hash module and a focused Prisma transaction executor that reuse the existing `Order.version` and `AdminCommandReceipt` schema introduced by C2-T1. Move the endpoint into the V1 Admin orders route, delete the legacy mutation path, remove `picked` from the generic status command, and update the React Admin client to send the visible version and one fresh UUID. No schema migration, dependency, distributed lock, PostgreSQL-only production SQL, reward, inventory or delivery-cancellation behavior is added.

**Tech Stack:** Node.js 20.19, TypeScript, Fastify 5, Prisma 6.19, PostgreSQL, React 18, Ant Design, Vitest, Playwright, pnpm 9.15.

## Global Constraints

- Base branch is `stable/l50-a3-4-business-base`; implementation branch is `codex/l50-c2-t2-pickup-verification`.
- Pickup verification is allowed only for `pickup_type=store` and `order_status=ready`.
- The generic Admin status command must reject `next_status=picked`.
- Require active Admin identity, `pickup.verify`, and current order data scope on initial execution and replay.
- Require `expected_version >= 1`, a 16–128 printable ASCII `idempotency_key` without surrounding whitespace, and an optional trimmed control-character-free `admin_remark` of at most 500 JavaScript code units.
- Same Admin/key/same canonical command replays the saved 200 response without duplicate effects; same Admin/key/different target, version or remark returns 409.
- Order update, version increment, business event, order timeline, Admin audit, and receipt completion commit in one transaction.
- A successful pickup verification changes `ready -> picked` only; it does not complete the order, set `completed_at`, or trigger reward, commission, refund or inventory writes.
- No new table, column, migration, dependency, Redis, MQ, advisory lock, `SELECT FOR UPDATE`, trigger or PostgreSQL-specific production SQL.
- Delivery-in-transit cancellation stays outside C2-T2.
- Runtime fixtures use `GITHUB_RUN_ID` or an equivalent unique suffix and delete receipts, logs, orders and fixture parents deterministically.
- Runner limits remain one workspace at a time, Vitest 1–2 workers, and a 3 GiB Node heap.

---

### Task 1: RED parser contract and generic-status bypass closure

**Files:**
- Create: `apps/api/src/modules/order/admin-pickup-verification-command.ts`
- Create: `apps/api/src/modules/order/admin-pickup-verification-command.test.ts`
- Modify: `apps/api/src/modules/order/admin-order-status-command.ts`
- Modify: `apps/api/src/modules/order/admin-order-status-command.test.ts`
- Modify: `scripts/admin-e2e/l50-c2-order-source-contract.test.cjs`

**Interfaces:**
- Produces: `parseAdminPickupVerificationCommand(input)`, `buildAdminPickupVerificationRequestHash(input)`, `AdminPickupVerificationCommand`, and `AdminPickupVerificationResult`.
- Preserves: the C2-T1 status parser and hash for `preparing | ready | delivered | completed`.
- Removes: `picked` from `AdminOrderStatusCommand['next_status']` and its allowed status set.

- [ ] **Step 1: Write parser RED**

Add tests that require this exact valid shape:

```ts
expect(parseAdminPickupVerificationCommand({
  expected_version: 4,
  idempotency_key: 'pickup-verify-key01',
  admin_remark: '顾客现场出示取货信息',
})).toEqual({
  ok: true,
  value: {
    expected_version: 4,
    idempotency_key: 'pickup-verify-key01',
    admin_remark: '顾客现场出示取货信息',
  },
});
```

Add independent invalid cases for null/array/unknown keys, version 0/fraction, key shorter than 16, non-ASCII key, padded key, remark over 500 code units, padded remark, `\u0000`, `\n`, and `\t`. Require absent `admin_remark` to parse as `null`.

- [ ] **Step 2: Write hash RED**

```ts
const hash = buildAdminPickupVerificationRequestHash({
  order_id: 'order-1',
  expected_version: 4,
  admin_remark: null,
});
expect(hash).toMatch(/^[a-f0-9]{64}$/);
expect(buildAdminPickupVerificationRequestHash({
  order_id: 'order-1',
  expected_version: 4,
  admin_remark: '现场核销',
})).not.toBe(hash);
```

The canonical JSON must contain only `operation: 'admin.order.pickup.verify.v1'`, `target_id`, `expected_version`, and `admin_remark`.

- [ ] **Step 3: Write generic-status bypass RED**

Add `{ next_status: 'picked', expected_version: 1, idempotency_key: 'idem-123456789012' }` to the invalid status-command table and add a source contract that fails while `picked` remains in the generic parser/result type.

- [ ] **Step 4: Run RED**

Run:

```bash
pnpm --filter @community-selection/api test --   src/modules/order/admin-pickup-verification-command.test.ts   src/modules/order/admin-order-status-command.test.ts
node --test scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
```

Expected: FAIL because the pickup command module does not exist and the generic parser still accepts `picked`.

- [ ] **Step 5: Implement minimal parser/hash and close the bypass**

Use:

```ts
const IDEMPOTENCY_KEY = /^[\x20-\x7e]{16,128}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const OPERATION = 'admin.order.pickup.verify.v1';
```

Reject any body whose own keys are outside `expected_version`, `idempotency_key`, and `admin_remark`. Preserve accepted key and remark exactly; canonicalize absent remark to `null`. Remove `OrderStatus.picked` and the `'picked'` union member from `admin-order-status-command.ts`.

- [ ] **Step 6: Run GREEN and commit**

Run the two focused Vitest files and the source contract again. Expected: all focused parser tests pass and `picked` is rejected by the generic command.

Commit:

```bash
git add apps/api/src/modules/order/admin-pickup-verification-command.ts   apps/api/src/modules/order/admin-pickup-verification-command.test.ts   apps/api/src/modules/order/admin-order-status-command.ts   apps/api/src/modules/order/admin-order-status-command.test.ts   scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
git commit -m "test(order): define reliable pickup verification command"
```

### Task 2: RED/GREEN atomic pickup executor on real PostgreSQL

**Files:**
- Create: `apps/api/src/modules/order/admin-pickup-verification-executor.ts`
- Create: `apps/api/src/modules/order/admin-pickup-verification-executor.integration.test.ts`

**Interfaces:**
- Consumes: `AdminPickupVerificationCommand`, `buildAdminPickupVerificationRequestHash`, `AdminAccessContext`, `canAccessOrderDataScope`, `recordBusinessEvent`, `recordOrderTimeline`, `recordAdminAudit`, Prisma interactive transactions.
- Produces: `executeAdminPickupVerificationCommand(input): Promise<AdminPickupVerificationResult>` and `AdminPickupVerificationError`.
- Error codes: `ADMIN_ORDER_NOT_FOUND`, `ADMIN_FORBIDDEN`, `ADMIN_IDEMPOTENCY_KEY_REUSED`, `ADMIN_ORDER_VERSION_CONFLICT`, `ADMIN_PICKUP_TYPE_CONFLICT`, `ADMIN_PICKUP_STATE_CONFLICT`, `ADMIN_PICKUP_VERIFY_FAILED`.

- [ ] **Step 1: Create isolated PostgreSQL fixtures**

Create one active Admin, user, community, pickup store, store-ready order and delivery-ready order using a unique suffix. Cleanup in dependency order: receipts, business events, Admin audits, timelines, orders, pickup store/community/user/Admin.

- [ ] **Step 2: Write success and eligibility RED**

Require store + ready + matching version to return:

```ts
{
  order_id,
  order_no,
  order_status: 'picked',
  version: 2,
}
```

Assert exactly one `pickup_verified` business event, one `pickup_verified` timeline row, one `order_pickup_verified` audit, one completed receipt, unchanged `completed_at`, and no completion/commission event.

Add independent zero-side-effect tests for delivery + ready, store + non-ready, stale version, missing order, and out-of-scope context.

- [ ] **Step 3: Write concurrency and replay RED**

Run two different keys concurrently with `expected_version=1`; require one fulfilled result and one `ADMIN_ORDER_VERSION_CONFLICT`. Run the same key concurrently; require equal results, one receipt and exactly one copy of each side effect. Replay after changing current scope to no access; require `ADMIN_FORBIDDEN`.

- [ ] **Step 4: Write atomic rollback RED**

Inject failures for `BusinessEventLog`, `OrderTimelineLog`, `AdminAuditLog`, and receipt completion one at a time. After each failure require `order_status=ready`, `version=1`, no committed logs, and no completed/success receipt. Test infrastructure may use PostgreSQL triggers to force failures; production executor may not contain raw or PostgreSQL-specific SQL.

- [ ] **Step 5: Run RED on migrated PostgreSQL**

Run:

```bash
pnpm --filter @community-selection/api test --   src/modules/order/admin-pickup-verification-executor.integration.test.ts
```

Expected: FAIL because the executor module does not exist.

- [ ] **Step 6: Implement receipt replay and typed result validation**

Lookup `(admin_user_id, idempotency_key)` before the transaction. A replay must compare the canonical request hash, reload `id/pickup_store_id/community_id`, reapply `canAccessOrderDataScope`, and accept only a completed receipt with HTTP 200, code `ADMIN_PICKUP_VERIFIED`, and a valid result.

- [ ] **Step 7: Implement one short transaction**

Inside the transaction: create incomplete receipt; load order; check scope; check `pickup_type === 'store'`; check `order_status === 'ready'`; check exact version; conditionally update with all four predicates; increment version; strictly write event, timeline and audit; complete receipt; return result.

Use this conditional write:

```ts
const changed = await tx.order.updateMany({
  where: {
    id: input.order_id,
    version: input.command.expected_version,
    pickup_type: 'store',
    order_status: 'ready',
  },
  data: {
    order_status: 'picked',
    version: { increment: 1 },
  },
});
```

If count is zero, reload and map the current type, state or version without guessing. Handle receipt `P2002` only outside the aborted transaction by loading and replaying the committed receipt.

- [ ] **Step 8: Run GREEN and commit**

Run the focused PostgreSQL test file. Expected: every eligibility, concurrency, replay and rollback case passes with deterministic cleanup.

Commit:

```bash
git add apps/api/src/modules/order/admin-pickup-verification-executor.ts   apps/api/src/modules/order/admin-pickup-verification-executor.integration.test.ts
git commit -m "feat(order): execute atomic pickup verification"
```

### Task 3: V1 Admin route and legacy-path retirement

**Files:**
- Modify: `apps/api/src/routes/admin/orders.ts`
- Create: `apps/api/src/routes/admin/order-pickup-verification-route.integration.test.ts`
- Modify: `apps/api/src/routes/fulfillment.ts`
- Modify: `apps/api/src/modules/order/order-service.ts`
- Modify: `apps/api/src/routes/admin/order-auxiliary-security.integration.test.ts`
- Modify: `scripts/admin-e2e/l50-c2-order-source-contract.test.cjs`

**Interfaces:**
- Produces: `POST /api/admin/orders/:id/pickup-verify` with `config.adminContractV1=true` and `requireAdminPermissionV1('pickup.verify')`.
- Removes: the endpoint from `registerFulfillmentRoutes` and the `pickupVerify()` export from `order-service.ts`.
- Preserves: fulfillment overview and every consumer order route.

- [ ] **Step 1: Write route RED**

Cover malformed JSON and invalid bodies as 400 `INVALID_ADMIN_PICKUP_VERIFY_COMMAND`; missing/inactive identity as 401; missing permission and out-of-scope order as 403 `ADMIN_FORBIDDEN`; missing order as 404; type/state/version/key conflicts as their 409 codes; success as 200 `ADMIN_PICKUP_VERIFIED`; and unexpected database errors as sanitized 500 `ADMIN_PICKUP_VERIFY_FAILED`.

Every response must use the V1 envelope and include `trace_id`.

- [ ] **Step 2: Write retirement RED**

Source contracts must require exactly one production registration of `/api/admin/orders/:id/pickup-verify`, located in `routes/admin/orders.ts`; no `pickupVerify` import/call in `fulfillment.ts`; no exported legacy mutation in `order-service.ts`; and no `safeRecordBusinessEvent` or `safeRecordOrderTimeline` in the new executor.

- [ ] **Step 3: Run RED**

Run the new route integration test, existing auxiliary security test, and source contract. Expected: FAIL because the endpoint still has a legacy envelope/path and the legacy service remains callable.

- [ ] **Step 4: Register the V1 route**

Add a focused pre-handler error handler mirroring C2-T1 but returning pickup-specific codes/messages. Parse the body, call the pickup executor with sanitized Admin metadata, map typed errors exactly, and log only error name, order ID and trace ID on unexpected failures.

- [ ] **Step 5: Remove the legacy mutation path**

Delete only the pickup POST registration and related imports/types from `fulfillment.ts`. Delete only `pickupVerify()` from `order-service.ts`; keep order creation and other existing exports unchanged. Update the auxiliary security test to exercise the V1 route contract.

- [ ] **Step 6: Run GREEN and commit**

Run focused route, executor, auxiliary and source tests. Expected: one V1 mutation path remains, with no legacy or generic-status bypass.

Commit:

```bash
git add apps/api/src/routes/admin/orders.ts   apps/api/src/routes/admin/order-pickup-verification-route.integration.test.ts   apps/api/src/routes/admin/order-auxiliary-security.integration.test.ts   apps/api/src/routes/fulfillment.ts   apps/api/src/modules/order/order-service.ts   scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
git commit -m "feat(api): expose reliable pickup verification"
```

### Task 4: Admin request contract and pickup-only action

**Files:**
- Modify: `apps/admin/src/features/sales/orders/types.ts`
- Modify: `apps/admin/src/features/sales/orders/api.ts`
- Modify: `apps/admin/src/features/sales/orders/api.test.ts`
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`
- Modify: `apps/admin/src/features/sales/orders/OrdersTable.tsx`
- Create: `apps/admin/src/features/sales/orders/OrdersTable.test.tsx` if the existing test environment supports component rendering; otherwise extend the approved source contract for the exact render predicate.

**Interfaces:**
- Produces: `verifyOrderPickup(orderId, expectedVersion, idempotencyKey, adminRemark, request?)`.
- Produces: `AdminPickupVerificationResult = { order_id; order_no; order_status: 'picked'; version }`.
- UI predicate: `order.pickup_type === 'store' && order.order_status === 'ready'`.

- [ ] **Step 1: Write client RED**

Require:

```ts
await verifyOrderPickup(
  'o1',
  3,
  'pickup-verify-key01',
  '后台核销自提',
  request,
);
expect(request).toHaveBeenCalledWith('/api/admin/orders/o1/pickup-verify', {
  method: 'POST',
  body: JSON.stringify({
    expected_version: 3,
    idempotency_key: 'pickup-verify-key01',
    admin_remark: '后台核销自提',
  }),
});
```

- [ ] **Step 2: Write action-visibility RED**

Require exactly one `核销自提` action for a store-ready row, none for delivery-ready or store-non-ready rows, and no `onMarkOrder(order, 'picked')` or `已自提` generic action in production UI.

- [ ] **Step 3: Write conflict-refresh RED**

Require `OrdersPage` to call the client with `order.version` and `crypto.randomUUID()`; prevent duplicate clicks while that order is pending; and on `ADMIN_ORDER_VERSION_CONFLICT`, `ADMIN_PICKUP_TYPE_CONFLICT`, or `ADMIN_PICKUP_STATE_CONFLICT`, show a pickup conflict message and increment the list refresh version.

- [ ] **Step 4: Run RED**

Run:

```bash
pnpm --filter @community-selection/admin test --   src/features/sales/orders/api.test.ts   src/features/sales/orders/OrdersTable.test.tsx
node --test scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
```

Expected: FAIL because the client sends only `admin_remark`, every row shows pickup actions, and the generic `picked` button remains.

- [ ] **Step 5: Implement minimal client and UI changes**

Add the result type, change the request body, pass `order.version` and a fresh UUID, track pending order IDs locally, render the pickup button only for store-ready orders, delete the generic `已自提` button, and refresh only for the three pickup conflict codes.

- [ ] **Step 6: Run GREEN and commit**

Run the focused Admin tests, source contract and Admin typecheck.

Commit:

```bash
git add apps/admin/src/features/sales/orders/types.ts   apps/admin/src/features/sales/orders/api.ts   apps/admin/src/features/sales/orders/api.test.ts   apps/admin/src/features/sales/orders/OrdersPage.tsx   apps/admin/src/features/sales/orders/OrdersTable.tsx   apps/admin/src/features/sales/orders/OrdersTable.test.tsx   scripts/admin-e2e/l50-c2-order-source-contract.test.cjs
git commit -m "feat(admin): verify only eligible pickup orders"
```

### Task 5: Deterministic real-browser evidence

**Files:**
- Modify: `scripts/admin-e2e/fixture.ts`
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`
- Create: `.github/workflows/l50-c2-t2-pickup-verification-gate.yml`

**Interfaces:**
- Fixture produces: one store-ready order and one delivery-ready order, both with explicit version 1 and unique run suffix.
- Browser consumes: the real Admin session and real PostgreSQL-backed endpoint.
- Temporary workflow runs: focused contracts, real PostgreSQL tests, repository gates, Admin Playwright and cleanup.

- [ ] **Step 1: Write browser/source RED**

Require the fixture to expose both order IDs/numbers. Require the browser to see one pickup button only on the store-ready row; assert the delivery row has none; capture the real request and assert `expected_version=1`, a UUID-shaped idempotency key, and the bounded remark.

- [ ] **Step 2: Define deterministic conflict evidence**

Use the same proven C2-T1 real-proxy pattern: allow two real UI commands based on the same visible version to reach the real backend, return the real 200 first and the real 409 second, and assert success refresh plus conflict refresh. Do not directly mutate the database from the browser test and do not mock a 2xx/409 business response.

- [ ] **Step 3: Update the route-registration whitelist**

Allow the named pickup real proxy in `contract.test.cjs`; keep all success responses sourced from `route.fetch()`; keep one-shot 500 handlers scoped to their own ranges.

- [ ] **Step 4: Add temporary bounded workflow**

Use the existing self-hosted labels/resource constraints. The workflow checks out the exact branch head, installs with frozen lockfile, starts PostgreSQL, migrates/generates, runs focused tests, `pnpm verify:all`, Admin browser setup/smoke/cleanup, and always removes containers/volumes created by the task.

- [ ] **Step 5: Run RED then GREEN**

First commit only the new browser/static expectations and workflow; confirm the focused job fails for the missing behavior. Then implement the fixture and browser behavior, rerun the exact workflow, and require every step green.

Commit the GREEN evidence:

```bash
git add scripts/admin-e2e/fixture.ts scripts/admin-e2e/admin-smoke.mjs   scripts/admin-e2e/contract.test.cjs   .github/workflows/l50-c2-t2-pickup-verification-gate.yml
git commit -m "test(order): verify pickup command in real Admin browser"
```

### Task 6: Full verification, security review, cleanup and locked merge

**Files:**
- Review: every base-to-head changed file
- Delete after review: `.github/workflows/l50-c2-t2-pickup-verification-gate.yml`

**Interfaces:**
- Tested implementation head: exact SHA on which focused PostgreSQL, full repository and Playwright gates pass.
- Final head: tested head plus only deletion of the temporary workflow.
- Merge target: `stable/l50-a3-4-business-base`.

- [ ] **Step 1: Run fresh complete verification**

Require, on the exact implementation SHA:

```bash
pnpm --filter @community-selection/api test --   src/modules/order/admin-pickup-verification-command.test.ts   src/modules/order/admin-pickup-verification-executor.integration.test.ts   src/routes/admin/order-pickup-verification-route.integration.test.ts   src/routes/admin/order-auxiliary-security.integration.test.ts
pnpm --filter @community-selection/admin test -- src/features/sales/orders/api.test.ts
node --test scripts/admin-e2e/l50-c2-order-source-contract.test.cjs   scripts/admin-e2e/contract.test.cjs
pnpm verify:all
pnpm e2e:admin
```

Record exit codes and failure counts; success logs need only the final summary.

- [ ] **Step 2: Review base-to-head security and atomicity**

Check every requirement in the approved spec. In particular verify: one production path to `picked`; permission/active-account/scope rechecked on replay; no saved receipt can bypass current scope; all five writes share one transaction client; no best-effort logging; no secrets/unbounded body in logs; failure mapping is stable and sanitized; concurrency proves one writer; fixture IDs cannot collide across Runner jobs.

- [ ] **Step 3: Resolve all Critical/Important findings**

For each valid finding, return to RED/GREEN with a focused regression test. Do not merge with any Critical, Important or unresolved review item.

- [ ] **Step 4: Delete the temporary workflow**

Delete only `.github/workflows/l50-c2-t2-pickup-verification-gate.yml`. Compare final head to the green implementation head and require this deletion to be the only difference.

- [ ] **Step 5: Recheck PR metadata and exact head**

Require draft/ready state as planned, mergeable status, no unresolved threads, and the remote head equal to the reviewed final SHA.

- [ ] **Step 6: Squash merge with head protection**

Squash merge into `stable/l50-a3-4-business-base` using the exact final head SHA. Re-read the PR and stable branch after merge; report the PR URL, merge commit, tested implementation SHA, final cleanup SHA, and next task `L50-C2-T3`.

## Self-Review

- Spec coverage: parser, sole-write boundary, store/ready eligibility, authorization, scope replay, versioning, idempotency, concurrency, atomic logs/receipt, V1 envelopes, Admin visibility, conflict refresh, PostgreSQL/browser evidence, portability and merge gates each map to a task.
- Placeholder scan: no TBD/TODO, generic “add tests”, “appropriate error handling”, or undefined implementation step remains.
- Type consistency: request fields are `expected_version`, `idempotency_key`, `admin_remark`; operation is `admin.order.pickup.verify.v1`; success code is `ADMIN_PICKUP_VERIFIED`; result has `order_id`, `order_no`, `order_status: 'picked'`, and `version`.
