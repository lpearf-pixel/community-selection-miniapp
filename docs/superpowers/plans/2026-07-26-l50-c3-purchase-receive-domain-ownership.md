# L50-C3 Purchase Receive Domain Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make purchase receiving a reliable, replayable Admin command whose Purchase, Inventory, Batch, and Audit writes remain consistent under retries, concurrency, and failure.

**Architecture:** Keep one synchronous Prisma/PostgreSQL transaction. The Admin executor owns command receipts and orchestration; `purchase-plan-owner`, `purchase-inventory-owner`, `purchase-batch-owner`, and `recordAdminAudit` exclusively mutate their domains. A purchase-plan row lock serializes lifecycle and cumulative receipt checks, while stable product ordering plus product row locks makes stock ledgers continuous across concurrent plans.

**Tech Stack:** Node.js, TypeScript, Fastify, Prisma 6.19.3, PostgreSQL, React, Vitest, pnpm 9.15.4.

## Global Constraints

- Base commit is `ffe1d71c297692554af797a0ff3a0d1d2950c893`; development branch is `codex/l50-c3-purchase-receive-domain-ownership`.
- Preserve purchase quantities, cost amounts, supplier/date/shelf-life rules, response envelopes, page layout, button meaning, and existing Chinese validation copy.
- Do not change Prisma schema, migrations, dependencies, lockfile, miniapp, loss, stock-check, refund, withdrawal, delivery, POS, MQ, or microservice code.
- Amounts remain integer cents and quantities remain safe integers.
- Purchase, inventory, batch, both ledgers, Admin audit, and command receipt remain in one PostgreSQL transaction.
- `idempotency_key` is required, printable ASCII, 16–128 characters, and unchanged by trimming.
- A completed receipt replays only when operation, target, request hash, status, code, and response data all match.
- Confirm, cancel, and receive acquire the same purchase-plan row lock before reading state.
- Positive receipt items acquire product locks in stable `product_id`, `item_id` order.
- Zero quantity items create no inventory, batch, ledger, or batch audit side effect.

---

### Task 1: Strict Purchase Receive Command

**Files:**
- Create: `apps/api/src/modules/purchase/admin-purchase-receive-command.test.ts`
- Create: `apps/api/src/modules/purchase/admin-purchase-receive-command.ts`

**Interfaces:**
- Produces `AdminPurchaseReceiveCommand`, `AdminPurchaseReceiveResult`, `parseAdminPurchaseReceiveCommand(input)`, and `buildAdminPurchaseReceiveRequestHash(input)`.
- `AdminPurchaseReceiveResult` is the existing purchase plan response with `items`; it must pass `isAdminPurchaseReceiveResult(value, purchasePlanId)`.

- [ ] **Step 1: Write parser and hash tests**

Cover non-object input, unknown keys, missing/trimmed/short/non-ASCII idempotency keys, empty items, duplicate `item_id`, unsafe/negative quantities, invalid optional strings/dates/shelf life, a fully normalized command, and hash changes for plan ID, order, each item field, and remark.

The parser-success literal is:

```ts
{
  idempotency_key: 'purchase-receive-0001',
  remark: '后台采购入库',
  items: [{
    item_id: 'item-1',
    received_quantity: 4,
    supplier_id: undefined,
    production_date: undefined,
    arrival_date: undefined,
    shelf_life_days: undefined,
    remark: undefined,
  }],
}
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/purchase/admin-purchase-receive-command.test.ts
```

Expected: fail because `admin-purchase-receive-command.js` does not exist.

- [ ] **Step 3: Implement strict parsing and hashing**

Reject undeclared root and item keys. Preserve item order in:

```ts
JSON.stringify({
  operation: 'admin.purchase-plan.receive.v1',
  purchase_plan_id,
  remark,
  items,
})
```

Normalize optional empty remarks to `undefined`; validate supplied ISO dates by `Date.parse`; require positive safe integer shelf life.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 command. Expected: all Task 1 tests pass.

---

### Task 2: Purchase Plan Owner and Lifecycle Lock

**Files:**
- Create: `apps/api/src/modules/purchase/purchase-plan-owner.test.ts`
- Create: `apps/api/src/modules/purchase/purchase-plan-owner.ts`
- Modify: `apps/api/src/modules/purchase/purchase-service.ts`

**Interfaces:**
- Produces:
  - `lockPurchasePlan(tx, purchasePlanId): Promise<LockedPurchasePlan>`
  - `validatePurchaseReceipt(lockedPlan, command): ValidatedReceiptItem[]`
  - `applyPurchaseReceipt(tx, input): Promise<PurchasePlanWithItems>`
  - `transitionPurchasePlan(tx, input): Promise<PurchasePlanWithItems>`
- `ValidatedReceiptItem` contains the current plan item plus normalized receipt fields and parsed dates.

- [ ] **Step 1: Write lock, validation, projection, and transition tests**

Assert `$queryRaw` executes:

```sql
SELECT id FROM "PurchasePlan" WHERE id = ... FOR UPDATE
```

before `purchasePlan.findUnique`. Cover missing plan, invalid receive state, duplicate/missing item, complete-command validation before writes, partial receipt projecting `ordered`, full receipt projecting `received`, cumulative overflow, confirm from draft, cancel from draft/confirmed, and rejected transitions.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/purchase/purchase-plan-owner.test.ts
```

Expected: fail because `purchase-plan-owner.js` does not exist.

- [ ] **Step 3: Implement Purchase-only writes**

`lockPurchasePlan` locks then loads `items`. `validatePurchaseReceipt` performs every item, quantity, supplier/date-independent validation without writes. `applyPurchaseReceipt` increments each positive item once, reloads the plan, and sets status from all current item totals. `transitionPurchasePlan` uses the shared lock and writes only `purchasePlan`.

- [ ] **Step 4: Delegate existing lifecycle service functions**

Keep public signatures of `confirmPurchasePlan` and `cancelPurchasePlan`; inside their existing transactions call `transitionPurchasePlan`, then strict `recordAdminAudit`. Do not change `createPurchasePlan`.

- [ ] **Step 5: Verify GREEN**

Run the Task 2 test and existing L13/L14 purchase-focused tests. Expected: all pass.

---

### Task 3: Inventory and Batch Owners

**Files:**
- Create: `apps/api/src/modules/inventory/purchase-inventory-owner.test.ts`
- Create: `apps/api/src/modules/inventory/purchase-inventory-owner.ts`
- Create: `apps/api/src/modules/inventory/purchase-batch-owner.test.ts`
- Create: `apps/api/src/modules/inventory/purchase-batch-owner.ts`
- Modify: `apps/api/src/modules/inventory/inventory-service.ts`

**Interfaces:**
- Produces:
  - `receivePurchaseInventory(tx, input): Promise<PurchaseInventoryResult>`
  - `loadPurchaseSupplierSnapshots(tx, items): Promise<Map<string, SupplierSnapshot | null>>`
  - `createPurchaseBatch(tx, input): Promise<PurchaseBatchResult | null>`
- `PurchaseInventoryResult` contains `product_id`, `stock_before`, `stock_after`, `stock_unit`, and `stock_ledger_id`.
- `PurchaseBatchResult` contains `batch_id`, `batch_no`, and `batch_ledger_id`.

- [ ] **Step 1: Write Inventory owner tests**

Assert product `$queryRaw ... FOR UPDATE` precedes the current product read. Cover missing product, atomic increment, literal before/after values, ledger source compatibility, and idempotency key:

```text
purchase-receive:<receipt_id>:<item_id>
```

- [ ] **Step 2: Verify Inventory RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/inventory/purchase-inventory-owner.test.ts
```

Expected: fail because the owner module does not exist.

- [ ] **Step 3: Implement Inventory-only writes**

Lock and reload `Product`, update stock, create `StockLedger`, and return its ID. Never write purchase, batch, audit, or receipt tables. Make legacy `receivePurchaseStock` delegate or remain unused without duplicating the new path.

- [ ] **Step 4: Write Batch owner tests**

Cover supplier lookup and missing supplier, arrival/production/shelf-life validation, supplier snapshot fields, batch payload compatibility, batch ledger values from `PurchaseInventoryResult`, and zero quantity returning `null` without writes.

- [ ] **Step 5: Verify Batch RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/inventory/purchase-batch-owner.test.ts
```

Expected: fail because the owner module does not exist.

- [ ] **Step 6: Implement Batch-only writes**

Generate the existing `PB...` batch number, create `ProductBatch`, create `BatchStockLedger`, and return both IDs. Never mutate product stock, stock ledger, purchase, audit, or receipt tables.

- [ ] **Step 7: Verify GREEN**

Run both Task 3 files and API typecheck. Expected: all pass.

---

### Task 4: Reliable Admin Executor and Ownership Contract

**Files:**
- Create: `apps/api/src/modules/purchase/admin-purchase-receive-executor.test.ts`
- Create: `apps/api/src/modules/purchase/admin-purchase-receive-executor.ts`
- Create: `apps/api/src/modules/purchase/purchase-domain-ownership.contract.test.ts`
- Modify: `apps/api/src/modules/purchase/purchase-service.ts`

**Interfaces:**
- Produces:
  - `executeAdminPurchaseReceiveCommand(input): Promise<AdminPurchaseReceiveResult>`
  - `AdminPurchaseReceiveCommandError`
- `receivePurchasePlan` preserves its public wrapper signature and delegates to the executor.

- [ ] **Step 1: Write receipt replay tests**

Cover no receipt, exact completed replay, request-hash mismatch, wrong operation/target, incomplete receipt, malformed response, unique-key race replay, and transaction failure leaving no successful receipt.

- [ ] **Step 2: Write successful orchestration tests**

Assert this observable order:

```text
create receipt
lock/validate purchase
load supplier snapshots
stable product/item sort
inventory owner
batch owner
purchase projection
batch audits
plan audit
complete receipt
```

Assert audit payload contains only idempotency key, receipt ID, item increments, batch IDs, and stock ledger IDs.

- [ ] **Step 3: Verify executor RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/purchase/admin-purchase-receive-executor.test.ts
```

Expected: fail because `admin-purchase-receive-executor.js` does not exist.

- [ ] **Step 4: Implement the reliable executor**

Use operation `admin.purchase-plan.receive.v1` and success code `ADMIN_PURCHASE_PLAN_RECEIVED`. Create and complete `AdminCommandReceipt` inside the same transaction. Map idempotency and lifecycle concurrency conflicts to 409; preserve known business messages; map unknown failures to 500 `采购入库失败`.

- [ ] **Step 5: Write source ownership contract**

Assert `purchase-service.ts` and executor do not directly mutate Product, StockLedger, ProductBatch, BatchStockLedger, or AdminAuditLog. Assert each owner does not write another owner’s tables. Require references to all owner interfaces and `recordAdminAudit`.

- [ ] **Step 6: Verify ownership RED then GREEN**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/purchase/admin-purchase-receive-executor.test.ts \
  src/modules/purchase/purchase-domain-ownership.contract.test.ts
```

Expected after refactor: all pass.

---

### Task 5: Route and Admin Client Compatibility

**Files:**
- Modify: `apps/api/src/routes/inventory.ts`
- Modify: `apps/admin/src/features/inventory/shared/types.ts`
- Modify: `apps/admin/src/features/supply/purchase-plans/api.ts`
- Modify: `apps/admin/src/features/supply/purchase-plans/api.test.ts`
- Modify: `apps/admin/src/features/supply/purchase-plans/PurchasePlansPage.tsx`

**Interfaces:**
- Route consumes only a parsed `AdminPurchaseReceiveCommand`.
- Admin API produces `createPurchaseReceiveCommand(input, keyFactory)` and sends that same object once through `receivePurchasePlan`.

- [ ] **Step 1: Write route/parser contract tests**

Extend the command tests and existing route/static verifier so invalid commands return the standard fail envelope; `AdminPurchaseReceiveCommandError` preserves its HTTP status and stable code.

- [ ] **Step 2: Write Admin client RED**

Update `api.test.ts` to require a generated key such as `purchase-receive-test-0001`, verify one key-factory call per user action, and verify the exact command object reaches `JSON.stringify`.

- [ ] **Step 3: Implement API and page wiring**

Extend `ReceivePurchasePlanInput` with `idempotency_key`. Generate a new printable ASCII key once inside the page click handler using `crypto.randomUUID()` with a timestamp/random fallback; construct the command before the request so transport retry reuses it. Keep layout and success text unchanged.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/supply/purchase-plans/api.test.ts
pnpm --filter @community-selection/api typecheck
pnpm --filter @community-selection/admin typecheck
```

Expected: all pass.

---

### Task 6: PostgreSQL Concurrency, Rollback, and Release Gate

**Files:**
- Create: `apps/api/src/modules/purchase/purchase-domain-ownership.integration.test.ts`
- Create: `scripts/verify-l50-c3-purchase-receive-domain-ownership.mjs`
- Modify: `scripts/verify-all-local.sh`
- Modify: existing L13/L14 verifiers only where source locations moved
- Modify: L50 task ledger only if a dedicated C3 row exists

**Interfaces:**
- Integration tests use the real Prisma client and `DATABASE_URL`.
- Verifier runs the focused owner, contract, integration, Admin API, and API typecheck suites.

- [ ] **Step 1: Write PostgreSQL scenarios**

Create literal fixtures for: partial then full receipt; serial and concurrent exact replay; same-plan distinct-key over-receipt; different-plan same-product continuity; crossed two-product plans; cancel versus receive; and injected failure at Purchase, Inventory, Batch, BatchLedger, Audit, and receipt completion.

For each rollback injection, assert unchanged counts and values for `PurchasePlan`, `PurchasePlanItem`, `Product`, `StockLedger`, `ProductBatch`, `BatchStockLedger`, `AdminAuditLog`, and `AdminCommandReceipt`.

- [ ] **Step 2: Run integration RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/purchase/purchase-domain-ownership.integration.test.ts
```

Expected: fail before all concurrency and rollback behavior is wired; if local PostgreSQL is unavailable, retain the test for the `community` Runner and rely on unit/contract RED locally.

- [ ] **Step 3: Complete minimal concurrency behavior**

Fix only failures proven by the integration scenarios. Do not add retries, schema constraints, queues, or unrelated refactors.

- [ ] **Step 4: Register focused verifier**

The verifier runs:

```text
command tests
Purchase owner tests
Inventory owner tests
Batch owner tests
executor tests
ownership contract
PostgreSQL integration
Admin purchase API test
API/Admin typecheck
```

Append `node scripts/verify-l50-c3-purchase-receive-domain-ownership.mjs` after the existing refund verifier in `verify-all-local.sh`.

- [ ] **Step 5: Run final local gates**

Run with pnpm 9.15.4:

```bash
node scripts/verify-l50-c3-purchase-receive-domain-ownership.mjs
pnpm --filter @community-selection/api typecheck
pnpm --filter @community-selection/admin typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all database-independent tests and static/build gates pass; PostgreSQL tests pass locally when `DATABASE_URL` is available and otherwise must pass on the exact remote head.

- [ ] **Step 6: Publish and verify**

Publish only expected files to `codex/l50-c3-purchase-receive-domain-ownership`, create a Draft PR into `stable/l50-a3-4-business-base`, and wait for the serial `community` Runner. Require focused purchase/inventory gates, real PostgreSQL, real Admin browser, 61-item audit, and `verify:all` success before converting the PR to Ready.

## Self-Review

- Spec coverage: Tasks 1–6 cover strict parsing, replay, lifecycle/product locking, all four owners, stable lock order, zero-quantity behavior, compatibility, PostgreSQL concurrency, rollback, Admin browser wiring, and release gates.
- Placeholder scan: no deferred implementation markers or unspecified “similar” steps remain.
- Type consistency: `AdminPurchaseReceiveCommand`, `AdminPurchaseReceiveResult`, `ValidatedReceiptItem`, `PurchaseInventoryResult`, and `PurchaseBatchResult` have one producer and explicit consumers.
- Scope check: no Prisma, dependency, miniapp, loss, stock-check, withdrawal, refund, delivery, POS, MQ, or microservice work is included.
