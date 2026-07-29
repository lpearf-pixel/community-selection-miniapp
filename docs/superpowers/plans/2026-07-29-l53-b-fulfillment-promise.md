# L53-B Fulfillment State and Promise Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist race-safe local-delivery state and immutable checkout-time fulfillment promises while retaining the existing pickup-verification owner.

**Architecture:** Extend `Order` as the single fulfillment source of truth. A pure promise builder resolves stored rule or group-buy inputs, order creation saves its result, and a dedicated idempotent admin command owns delivery transitions.

**Tech Stack:** TypeScript, Fastify, Prisma, PostgreSQL, Vitest, React/Vite admin, native WeChat miniapp, pnpm 9.

## Global Constraints

- Work on PR #119 branch `codex/l53-first-launch-closure`.
- Keep `FIRST_LAUNCH_MODE=true` behavior and all L53-A guards intact.
- New delivery writes use only `pending_dispatch`, `delivering`, `delivered`, and `exception`.
- Pickup completion remains owned by `executeAdminPickupVerificationCommand`.
- Promise timezone is exactly `Asia/Shanghai`.
- Promise snapshots are created with the order and are never recomputed during reads or status updates.
- Do not add third-party courier calls, WeChat shipping synchronization, after-sales expansion, membership, coupons, rewards, or withdrawals.
- Follow red-green TDD; production code follows an observed feature-specific failure.

---

### Task 1: Build immutable promise snapshots

**Files:**
- Create: `apps/api/src/modules/fulfillment/fulfillment-promise.ts`
- Test: `apps/api/src/modules/fulfillment/fulfillment-promise.test.ts`
- Modify: `apps/api/src/modules/delivery/delivery-rule-service.ts`

**Interfaces:**
- Produces: `buildFulfillmentPromise(input): FulfillmentPromiseFields`
- Produces: `DeliveryTimeWindow.day_offset?: number`
- Consumes later: order creation services and public DTO mappers

- [ ] **Step 1: Write failing pure tests**

Cover these hand-derived fixtures:

1. At `2026-07-29T01:30:00.000Z` (09:30 Shanghai), a delivery window `{day_offset: 0,start_time:"14:00",end_time:"18:00"}` resolves to `2026-07-29T06:00:00.000Z` and `2026-07-29T10:00:00.000Z`.
2. A historical `tomorrow_morning` window without `day_offset` resolves one Shanghai calendar day later.
3. A group-buy pickup copies the exact pickup instant and produces a human-readable Shanghai snapshot.
4. A normal pickup produces `门店确认后通知自提时间` with null boundaries.
5. Overnight or invalid windows are rejected rather than silently shifted.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/fulfillment/fulfillment-promise.test.ts
```

Expected: fail because `fulfillment-promise.ts` does not exist.

- [ ] **Step 3: Add the minimum pure builder**

Define discriminated inputs for `delivery`, `group_buy_pickup`, and `normal_pickup`. Return Prisma-ready fields:

```ts
type FulfillmentPromiseFields = {
  fulfillment_promise_snapshot: Prisma.InputJsonValue;
  promised_fulfillment_start_at: Date | null;
  promised_fulfillment_end_at: Date | null;
};
```

Resolve Shanghai calendar dates without reading `process.env.TZ`; accept `capturedAt` as an injected input so tests are deterministic.

- [ ] **Step 4: Run tests and verify GREEN**

Run the targeted test and the existing delivery-rule tests. Expected: zero failures.

- [ ] **Step 5: Commit**

Commit message: `feat(l53): define fulfillment promise snapshots`.

---

### Task 2: Persist promises and delivery state

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202607290001_l53_fulfillment_promise/migration.sql`
- Modify: `apps/api/src/modules/order/order-service.ts`
- Test: `apps/api/src/modules/order/order-fulfillment-promise.integration.test.ts`

**Interfaces:**
- Adds: `DeliveryFulfillmentStatus`
- Adds on `Order`: `delivery_status`, `delivery_status_updated_at`, `fulfillment_promise_snapshot`, `promised_fulfillment_start_at`, `promised_fulfillment_end_at`
- Consumes: `buildFulfillmentPromise`

- [ ] **Step 1: Write failing PostgreSQL integration tests**

Create real group-buy, product, user, store, community, and delivery-rule records. Assert literal persisted values for:

- a delivery order with an absolute Shanghai window and `pending_dispatch`;
- a group-buy pickup whose promised start equals `GroupBuy.pickup_time`;
- a normal pickup whose null bounds and explicit pending-confirmation snapshot are persisted;
- an idempotent retry returning the original snapshot even after the delivery rule changes.

- [ ] **Step 2: Run the integration test and verify RED**

Run with an isolated PostgreSQL `DATABASE_URL`. Expected: fail because the new columns and builder integration are absent.

- [ ] **Step 3: Add schema and migration**

Add the enum and nullable historical fields. Backfill active historical delivery orders to `pending_dispatch` and delivered/completed delivery orders to `delivered`. Do not fabricate historical JSON promises.

- [ ] **Step 4: Save snapshots in both order-creation transactions**

For delivery, pass the selected rule window plus rule metadata. For group pickup, pass `groupBuy.pickup_time`. For normal pickup, use the explicit pending-confirmation snapshot. Return the stored fields from `toPublicOrder`.

- [ ] **Step 5: Generate Prisma and verify GREEN**

Run:

```bash
pnpm prisma:generate
pnpm --filter @community-selection/api test -- src/modules/order/order-fulfillment-promise.integration.test.ts
```

Expected: all snapshot tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat(l53): persist order fulfillment promises`.

---

### Task 3: Make delivery transitions transactional and idempotent

**Files:**
- Create: `apps/api/src/modules/delivery/admin-delivery-status-command.ts`
- Create: `apps/api/src/modules/delivery/admin-delivery-status-executor.ts`
- Test: `apps/api/src/modules/delivery/admin-delivery-status-executor.integration.test.ts`
- Modify: `apps/api/src/modules/delivery/delivery-service.ts`
- Modify: `apps/api/src/modules/delivery/delivery-types.ts`
- Modify: `apps/api/src/routes/admin/delivery.ts`

**Interfaces:**
- Produces: `executeAdminDeliveryStatusCommand`
- Request: `{delivery_status,expected_version,idempotency_key,remark?}`
- Result: `{order_id,order_no,delivery_status,order_status,version,allowed_next_statuses}`

- [ ] **Step 1: Write failing command integration tests**

Use real PostgreSQL and assert:

- `pending_dispatch -> delivering -> delivered`;
- `exception` requires a non-empty remark and can recover to `pending_dispatch`;
- `delivered` is terminal;
- store pickup, unpaid, closed, and stale-version orders return their exact 4xx codes;
- same idempotency key and payload replays the original result;
- same key with a different payload returns 409;
- a failed transition changes no order fields and writes no completed receipt, timeline, business event, or admin audit;
- the promise snapshot is byte-equivalent before and after transitions.

- [ ] **Step 2: Run and verify RED**

Expected: failures show the existing endpoint only logs an override and does not persist a state or version.

- [ ] **Step 3: Implement command parsing and request hashing**

Use the established pickup/status command pattern. Reject unknown JSON fields, non-integer versions, unsupported statuses, malformed idempotency keys, and exception requests without remarks.

- [ ] **Step 4: Implement the transactional executor**

Create the command receipt, lock ownership with `updateMany({id,version,delivery_status})`, increment version, update `delivery_status_updated_at`, map delivered to `OrderStatus.delivered`, write all audit records, and complete the receipt inside one Prisma transaction.

- [ ] **Step 5: Wire the route and read service**

Read persisted state, expose allowed next states, filter against `delivery_status`, reject pickup orders from delivery status commands, and translate legacy query values only at the read boundary.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run the command integration test plus existing pickup-verification, admin scope, and delivery verifier suites. Expected: zero failures.

- [ ] **Step 7: Commit**

Commit message: `feat(l53): own delivery status transitions`.

---

### Task 4: Expose stored fulfillment facts

**Files:**
- Modify: `apps/api/src/modules/user-orders/user-order-service.ts`
- Modify: `apps/admin/src/api/delivery.ts`
- Modify: `apps/admin/src/pages/delivery/DeliveryReservationPage.tsx`
- Modify: `apps/miniapp/pages/orders/detail/index.wxml`
- Test: existing user-order and admin UI test files; add focused tests beside the changed module when no behavior test exists

**Interfaces:**
- User DTO: `fulfillment_status`, `fulfillment_status_text`, `fulfillment_promise`
- Admin DTO: `version`, `delivery_status`, `delivery_status_text`, `allowed_next_statuses`, promise fields

- [ ] **Step 1: Write failing DTO/UI behavior tests**

Assert that reads use the stored snapshot after a delivery rule changes, legacy orders render an explicit unavailable promise, addresses and phones stay masked, and the admin request sends current version plus a fresh idempotency key.

- [ ] **Step 2: Run and verify RED**

Expected: the fields and command payload are absent.

- [ ] **Step 3: Implement minimal mappings**

Render Chinese labels:

- `pending_dispatch`: 待配送
- `delivering`: 配送中
- `delivered`: 已送达
- `exception`: 配送异常
- pickup `ready`: 待自提
- pickup `picked`: 已自提

Never call the current delivery-rule service during an order read.

- [ ] **Step 4: Run targeted API, admin, and miniapp tests**

Expected: zero failures and no PII regressions.

- [ ] **Step 5: Commit**

Commit message: `feat(l53): display persisted fulfillment facts`.

---

### Task 5: Verify repository and production compatibility

**Files:**
- Modify: `docs/superpowers/plans/2026-07-29-l53-b-fulfillment-promise.md` only to check completed steps and record run evidence.

- [ ] **Step 1: Run local static and targeted gates**

```bash
pnpm lint
pnpm typecheck
pnpm --filter @community-selection/api test
pnpm --filter @community-selection/admin test
pnpm --filter @community-selection/miniapp test
```

- [ ] **Step 2: Run migration and repository gates**

```bash
pnpm build
pnpm verify:all
git diff --check 8049397caf9212c1f5a64684aca6d9c18b349d9f...HEAD
```

- [ ] **Step 3: Trigger Community Runner**

Require the L51 isolated-PostgreSQL gate and L52 production-readiness gate on the same final HEAD. Inspect failed logs rather than rerunning blindly.

- [ ] **Step 4: Record exact evidence**

Update PR #119 with targeted counts, workflow run IDs, final SHA, migration result, and any remaining L53-C/L53-D boundary. Keep the PR Draft.
