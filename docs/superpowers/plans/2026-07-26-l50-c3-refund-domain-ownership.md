# L50-C3 Refund Domain Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the refund-success write chain behind Refund, Order, AfterSale, Inventory, Consumer Credit, and Commission owners while preserving the reliable Admin refund contract and preventing concurrent over-refunds.

**Architecture:** Keep one synchronous Prisma/PostgreSQL transaction and two coordinators. `admin-refund-executor` owns the reliable command receipt, scope checks, Admin audit, and result mapping; `refund-service` sequences narrow owner commands but directly mutates none of the six business domains. The Order owner locks the order row before any remaining-balance calculation, so every entry point observes the latest committed refund projection.

**Tech Stack:** Node.js, TypeScript, Prisma 6.19.3, PostgreSQL, Vitest, pnpm 9.15.4.

## Global Constraints

- Base commit is `74dd7f931fbc98b2a1812a001a1cdeaca9930963`; development branch is `codex/l50-c3-refund-domain-ownership`.
- Preserve the public signatures of `executeAdminRefundCommand()`, `applyMockRefundInTransaction()`, `createMockRefund()`, and `markRefundSuccess()`.
- Do not change Prisma schema, migrations, dependencies, lockfile, Admin, miniapp, public API DTOs, refund amount rules, or Chinese error copy.
- Do not implement real WeChat refund, purchase, withdrawal, delivery, POS, outbox/inbox, MQ, or microservices.
- Refund, order, after-sale, inventory, credit, commission, required events/timelines, Admin audit, and command receipt remain in one PostgreSQL transaction.
- Required business events and timelines use strict recorders; warning-only rejection evidence may remain fail-open.
- Amounts remain integer cents; partial refunds do not automatically restore stock or return consumer credit.
- Full refund stock restore remains limited to the existing pre-fulfillment policy and is idempotent.
- Full refund returns `reward_conversion` credit once; commission recalculation continues through `syncCommissionAfterRefund()`.

---

### Task 1: Refund Record Owner

**Files:**
- Create: `apps/api/src/modules/refund/refund-record-service.test.ts`
- Create: `apps/api/src/modules/refund/refund-record-service.ts`

**Interfaces:**
- Consumes: `Prisma.TransactionClient`, `RefundInput`-compatible integer-cent data, provider notify fields.
- Produces:
  - `findRefundByClientKey(tx, input): Promise<Refund | null>`
  - `createPendingRefund(tx, input): Promise<Refund>`
  - `confirmRefundSuccess(tx, refundId, notifyInfo): Promise<{ refund: Refund; first_success: boolean }>`
  - `setRefundStockRestored(tx, refundId, restored): Promise<Refund>`

- [ ] **Step 1: Write owner tests before implementation**

Create table-driven Vitest cases using a transaction fake with only `refund`. Cover: lookup by `client_refund_id`, fallback lookup by `out_refund_no`, matching idempotent input, mismatched order/amount rejection, pending creation, first success, rejected refund rejection, provider `refund_id` collision, repeated success, provider ID backfill without overwriting an existing ID, raw notify preservation when omitted, and `stock_restored` update.

The test named `rejects reuse of a client refund key with different money` must fail if the owner accepts:

```ts
existing.refund_amount_cents === 500
input.refund_amount_cents === 600
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/refund/refund-record-service.test.ts
```

Expected: fail because `refund-record-service.js` does not exist.

- [ ] **Step 3: Implement the Refund-only owner**

Use `Prisma.JsonNull` only when a supplied JSON value is null. Never write `order`, `afterSaleCase`, `product`, `stockLedger`, `consumerCreditLedger`, or `commission`. Return `first_success: false` for an already-successful record and update only a missing provider ID/raw notification in that path.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 command. Expected: all Task 1 cases pass.

---

### Task 2: Order Refund Owner and Row Lock

**Files:**
- Create: `apps/api/src/modules/order/order-refund-service.test.ts`
- Create: `apps/api/src/modules/order/order-refund-service.ts`

**Interfaces:**
- Consumes: a refund record, optional `expected_order_version`, and strict logging functions.
- Produces:
  - `lockRefundableOrder(tx, orderId): Promise<Order>`
  - `projectRefundSuccess(tx, input): Promise<RefundedOrderProjection>`
  - `recordRefundOrderEffects(tx, input): Promise<void>`
  - `RefundOrderVersionConflictError`

`RefundedOrderProjection` contains:

```ts
{
  order: Order;
  is_full_refund: boolean;
  remaining_refundable_amount_cents: number;
}
```

- [ ] **Step 1: Write lock and projection tests**

Assert `tx.$queryRaw` executes `SELECT id FROM "Order" WHERE id = ... FOR UPDATE` before `findUnique`. Cover missing/unpaid/closed/already-refunded orders, partial accumulation, cumulative full refund, explicit version mismatch, compare-and-set count zero, split overflow, and total overflow.

The mutation “remove the row lock” must fail the call-order assertion; the mutation “use the stale pre-lock total” must fail the cumulative full-refund literal assertions.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/order/order-refund-service.test.ts
```

Expected: fail because `order-refund-service.js` does not exist.

- [ ] **Step 3: Implement Order-only writes**

Lock first, then load the current order. Compute:

```ts
nextRefund = order.refund_amount_cents + refund.refund_amount_cents
nextProduct = order.product_refund_amount_cents + refund.product_refund_amount_cents
nextDelivery = order.delivery_refund_amount_cents + refund.delivery_refund_amount_cents
```

Reject any component beyond its current remaining amount. Preserve the current order status for partial refund and use `refunded` only when `nextRefund >= pay_amount_cents`. Increment version only when the caller supplies `expected_order_version`, matching current Admin behavior.

`recordRefundOrderEffects()` uses strict `recordBusinessEvent()` and `recordOrderTimeline()` for the existing `refund_success` semantics.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 command. Expected: all Task 2 cases pass.

---

### Task 3: After-Sale and Consumer Credit Owners

**Files:**
- Modify: `apps/api/src/modules/after-sale/after-sale-service.ts`
- Create: `apps/api/src/modules/after-sale/after-sale-refund-owner.test.ts`
- Create: `apps/api/src/modules/consumer-credit/order-refund-credit-service.test.ts`
- Create: `apps/api/src/modules/consumer-credit/order-refund-credit-service.ts`

**Interfaces:**
- Produces:
  - `claimApprovedAfterSaleForRefund(tx, input): Promise<AfterSaleCase>`
  - `resolveAfterSaleWithRefund(tx, input): Promise<AfterSaleCase>`
  - `returnOrderCreditAfterFullRefund(tx, input): Promise<{ applied: boolean; idempotent: boolean; amount_cents: number }>`

- [ ] **Step 1: Write AfterSale owner tests**

Cover an approved conditional claim, lost concurrent claim (`count === 0`), missing target, scope callback failure propagation, resolve only from `processing`, refund association, resolved timestamp, Admin note, and strict after-sale log/event/timeline persistence.

- [ ] **Step 2: Verify AfterSale RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/after-sale/after-sale-refund-owner.test.ts
```

Expected: fail because the two owner exports do not exist.

- [ ] **Step 3: Implement AfterSale-only owner commands**

Move the existing executor state transitions into the new exports. The functions may write `afterSaleCase`, `afterSaleLog`, and the strict audit-log facade for their own business event/timeline, but no Refund, Order, Inventory, Credit, or Commission table.

- [ ] **Step 4: Write Consumer Credit owner tests**

Cover partial-refund skip, zero-credit skip, non-`reward_conversion` skip, existing `order_refund + order_id` idempotent return, current balance calculation, one inbound ledger row, strict credit event, and strict order timeline.

- [ ] **Step 5: Verify Consumer Credit RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/consumer-credit/order-refund-credit-service.test.ts
```

Expected: fail because `order-refund-credit-service.js` does not exist.

- [ ] **Step 6: Implement Credit-only writes**

Read all ledger entries for the user, derive the literal balance by direction, and create:

```ts
{
  source_type: 'order_refund',
  source_id: order.id,
  direction: 'in',
  amount_cents: order.credit_amount_cents,
  usable_scope: 'platform_order'
}
```

The Order row lock held by the coordinator protects this order-level idempotency decision.

- [ ] **Step 7: Verify GREEN**

Run both Task 3 test files. Expected: all cases pass.

---

### Task 4: Inventory Boundary and Refund Coordinator

**Files:**
- Modify: `apps/api/src/modules/inventory/inventory-order-service.ts`
- Modify: existing inventory tests covering `restoreInventoryForRefund()`
- Create: `apps/api/src/services/refund-domain-ownership.contract.test.ts`
- Modify: `apps/api/src/services/refund-service.ts`

**Interfaces:**
- Consumes all owners from Tasks 1–3 plus `restoreInventoryForRefund()` and `syncCommissionAfterRefund()`.
- Keeps existing public refund-service signatures.

- [ ] **Step 1: Write inventory boundary RED**

Update the inventory test so an applied restore returns `{ applied, idempotent, quantity, ledger_id, ... }` but never calls `tx.refund.update`. Run the focused inventory test and confirm it fails on the current reverse write.

- [ ] **Step 2: Remove the reverse Refund write**

Delete only the `tx.refund.update({ stock_restored: true })` call from `restoreInventoryForRefund()`. Refund projection is updated later through `setRefundStockRestored()`.

- [ ] **Step 3: Write the source ownership contract**

Execute source modules as text and assert:

```ts
refund-service.ts:
  no tx.refund create/update
  no tx.order update/updateMany
  no tx.afterSaleCase mutation
  no tx.consumerCreditLedger create
  no tx.product/tx.stockLedger mutation
  no tx.commission mutation

admin-refund-executor.ts:
  no direct mutation of those six domains

inventory-order-service.ts:
  no tx.refund mutation
```

Also require coordinator references to every applicable owner interface. Each owner source must be forbidden from mutating the other owners’ tables.

- [ ] **Step 4: Verify ownership RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/services/refund-domain-ownership.contract.test.ts
```

Expected: fail on current direct writes.

- [ ] **Step 5: Refactor the refund coordinator**

The coordinator order is:

```ts
lockRefundableOrder
find/create pending Refund
confirmRefundSuccess
projectRefundSuccess
restoreInventoryForRefund when cumulative full refund
setRefundStockRestored
returnOrderCreditAfterFullRefund
syncCommissionAfterRefund
recordRefundOrderEffects
strict refund audit
```

For `first_success: false`, return after provider backfill without re-running downstream effects. Keep warning-only rejection evidence fail-open. Do not set `Order.refund_status = pending`; the synchronous MOCK path reaches success in the same transaction and no consumer can observe that intermediate projection.

- [ ] **Step 6: Verify GREEN and compatibility**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/refund/refund-record-service.test.ts \
  src/modules/order/order-refund-service.test.ts \
  src/modules/after-sale/after-sale-refund-owner.test.ts \
  src/modules/consumer-credit/order-refund-credit-service.test.ts \
  src/services/refund-domain-ownership.contract.test.ts
pnpm --filter @community-selection/api typecheck
```

Expected: all focused tests and API typecheck pass.

---

### Task 5: Admin Coordinator and PostgreSQL Proof

**Files:**
- Modify: `apps/api/src/modules/refund/admin-refund-executor.ts`
- Modify: `apps/api/src/modules/refund/admin-refund-executor.integration.test.ts`
- Expand or replace: `apps/api/src/services/refund-domain-ownership.integration.test.ts`
- Modify only if stale source locations require it: existing refund/inventory verifiers.

**Interfaces:**
- Admin executor consumes `claimApprovedAfterSaleForRefund()`, `applyMockRefundInTransaction()`, and `resolveAfterSaleWithRefund()`.

- [ ] **Step 1: Add Admin/source RED cases**

Assert the executor delegates both after-sale state transitions and contains no `tx.afterSaleCase.update*`. Preserve receipt replay, scope, provider-unavailable, version-conflict, amount-conflict, and response DTO assertions.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/refund/admin-refund-executor.integration.test.ts \
  src/services/refund-domain-ownership.contract.test.ts
```

Expected: ownership assertion fails on direct AfterSale writes.

- [ ] **Step 3: Refactor Admin orchestration**

Keep receipt creation/completion, scope checks, Admin audit, error mapping, and response assembly in the executor. Delegate claim and resolution to the AfterSale owner. Preserve exact `AdminRefundCommandError` codes and messages.

- [ ] **Step 4: Add real PostgreSQL scenarios**

Create isolated fixtures and cover:

1. partial refund: amount only, no stock/credit return;
2. cumulative full refund: `refunded`, one stock restore;
3. full refund: one reward-conversion credit return;
4. commission amount adjusted/cancelled from the product-refund total;
5. duplicate and concurrent success notification: one inventory, credit, commission, success timeline, and audit effect;
6. two distinct concurrent partial refunds: committed total never exceeds paid amount and the excessive request rejects;
7. concurrent Admin execution: at most one mutation, with the other request replay/conflict under the existing contract;
8. injected failures in inventory, credit, commission, after-sale log, and Admin audit each leave literal pre-transaction counts and amounts.

- [ ] **Step 5: Local verification available without PostgreSQL**

Run API typecheck and every database-independent refund/after-sale/inventory test. PostgreSQL execution is deferred only when `DATABASE_URL` is unavailable; the integration file must still compile.

---

### Task 6: Release Verifier, Ledger, and Full Gate

**Files:**
- Create: `scripts/verify-l50-c3-refund-domain-ownership.mjs`
- Modify: `scripts/verify-all-local.sh`
- Modify: the current L50 task ledger only if a dedicated C3 row exists.

**Interfaces:**
- The verifier runs the focused owner/contract tests and the PostgreSQL integration test; it exits non-zero on any failure.

- [ ] **Step 1: Add the verifier**

Use `spawnSync()` with inherited stdio and explicit environment. Run owner/contract tests first, then the real integration test using the existing `DATABASE_URL`. Do not grep for an exact implementation line as proof of runtime behavior.

- [ ] **Step 2: Register once in `verify-all-local.sh`**

Add:

```bash
node scripts/verify-l50-c3-refund-domain-ownership.mjs
```

after the existing payment C3 verifier and before the registered L24–L47 chain.

- [ ] **Step 3: Update the ledger**

Record the refund-success ownership slice and preserve purchase and withdrawal ownership as later C3 work. If no dedicated ledger exists, do not invent a new tracking system.

- [ ] **Step 4: Run fresh local gates**

Run:

```bash
pnpm --filter @community-selection/api typecheck
pnpm lint
pnpm test
pnpm build
node --check scripts/verify-l50-c3-refund-domain-ownership.mjs
bash -n scripts/verify-all-local.sh
```

Expected: exit 0. If local PostgreSQL is unavailable, run all database-independent tests separately and reserve the complete `verify:all` for the `community` Runner.

- [ ] **Step 5: Scope audit and publish atomically**

Confirm the diff contains only the approved plan/spec, owner/refund/inventory tests and implementation, verifier, gate registration, and existing ledger. Build one commit tree from branch head `6aa8a895...`, update `codex/l50-c3-refund-domain-ownership` by non-force fast-forward, and verify remote Blob SHAs.

- [ ] **Step 6: Draft PR and serial Runner verification**

Create one Draft PR into `stable/l50-a3-4-business-base`. Use the automatically triggered existing heavy gate that runs `verify:all`; do not create duplicate Runner jobs. Require real PostgreSQL scenarios, real Admin browser, 61-item baseline audit, `verify:all`, evidence upload, and cleanup on the exact PR head before marking Ready.

