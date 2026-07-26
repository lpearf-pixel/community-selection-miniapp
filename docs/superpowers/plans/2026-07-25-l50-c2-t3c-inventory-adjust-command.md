# L50-C2-T3-C Inventory Adjustment Reliable Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Admin manual inventory adjustment idempotent, concurrency-safe, transactional, observable, and refresh correctly on browser conflicts.

**Architecture:** Add a strict command parser/hash module and a dedicated executor that owns receipt replay and one PostgreSQL transaction. Keep the existing route URL but move it onto the V1 contract and `product.manage` guard. Keep the Admin prompt UI, adding a per-product pending set and a small tested mutation helper for success/conflict refresh behavior.

**Tech Stack:** TypeScript, Fastify, Prisma 6, PostgreSQL, React 18, Ant Design, Vitest, Node test verifier.

## Global Constraints

- Only govern `POST /api/admin/inventory/products/:id/adjust`.
- Do not change Prisma schema, migrations, package manifests, lockfile, or dependencies.
- Do not change purchase receipt, batch loss, stock check, order deduction, refund restoration, delivery cancellation, or POS behavior.
- Request fields are exactly `expected_stock`, `adjust_quantity`, `reason`, and `idempotency_key`.
- Use `requireAdminPermissionV1('product.manage')` and the C1 V1 response envelope.
- Product stock, one `StockLedger`, one `BusinessEventLog`, one `AdminAuditLog`, and the completed `AdminCommandReceipt` commit or roll back together.
- A command creates exactly one root business event; event work remains O(1).

---

### Task 1: Strict inventory adjustment command

**Files:**
- Create: `apps/api/src/modules/inventory/admin-inventory-adjust-command.ts`
- Test: `apps/api/src/modules/inventory/admin-inventory-adjust-command.test.ts`

**Interfaces:**
- Produces: `AdminInventoryAdjustCommand`, `AdminInventoryAdjustResult`, `parseAdminInventoryAdjustCommand(input)`, and `buildAdminInventoryAdjustRequestHash(input)`.

- [ ] **Step 1: Write parser and hash tests**

Cover the literal valid command, unknown/missing fields, unsafe or fractional numbers, zero adjustment, negative/overflow target stock, trimmed and control-character reasons, printable untrimmed/short/long idempotency keys, stable normalization, and hash changes for every business field.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @community-selection/api exec vitest run src/modules/inventory/admin-inventory-adjust-command.test.ts
```

Expected: FAIL because the command module does not exist.

- [ ] **Step 3: Implement the minimal parser and SHA-256 hash**

Use operation `admin.inventory.product.adjust.v1`, an exact allowed-key set, `Number.isSafeInteger`, reason length 1–200 after trimming, control-character rejection, and printable ASCII idempotency keys of length 16–128 whose trim is unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Expected: all parser/hash cases pass.

### Task 2: Transactional executor and PostgreSQL behavior

**Files:**
- Create: `apps/api/src/modules/inventory/admin-inventory-adjust-executor.ts`
- Test: `apps/api/src/modules/inventory/admin-inventory-adjust-executor.test.ts`
- Test: `apps/api/src/modules/inventory/admin-inventory-adjust-executor.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 command/result/hash types.
- Produces: `AdminInventoryAdjustCommandError` and `executeAdminInventoryAdjustCommand({ product_id, command, context, admin_meta })`.

- [ ] **Step 1: Write failing executor contract tests**

Prove stable replay validation, same-key drift rejection, corrupt/incomplete receipt rejection, fixed success result shape, and typed error codes.

- [ ] **Step 2: Run executor tests and verify RED**

Expected: FAIL because the executor module does not exist.

- [ ] **Step 3: Implement replay and one-transaction execution**

Re-authorize via the route on every call. Resolve/create the `(admin_user_id, idempotency_key)` receipt, distinguish missing product from stale stock, apply `updateMany({ id, stock: expected_stock }, { increment })`, and write exactly one ledger/event/audit before completing the receipt.

- [ ] **Step 4: Run executor tests and verify GREEN**

Expected: focused executor tests pass.

- [ ] **Step 5: Write real PostgreSQL integration tests**

Cover positive/negative/zero-target adjustments, missing product, stale stock, same-key replay, same-key drift, two-key concurrency, one event despite unrelated history, and rollback injection at ledger/event/audit/receipt completion.

- [ ] **Step 6: Run PostgreSQL integration and verify RED/GREEN**

Run against an isolated migrated PostgreSQL database. Expected final result: all integration cases pass and final stock/side-effect counts match literal assertions.

### Task 3: Route cutover and legacy-path removal

**Files:**
- Modify: `apps/api/src/routes/inventory.ts`
- Modify: `apps/api/src/modules/inventory/inventory-service.ts`
- Create: `apps/api/src/routes/admin-inventory-adjust-route.test.ts`
- Create: `scripts/inventory-e2e/l50-c2-inventory-adjust-source-contract.test.cjs`

**Interfaces:**
- Consumes: Task 1 parser and Task 2 executor.
- Produces: V1 route codes `ADMIN_INVENTORY_ADJUSTED`, `INVALID_ADMIN_INVENTORY_ADJUST_COMMAND`, and typed 404/409/500 mappings.

- [ ] **Step 1: Write failing route/source tests**

Assert V1 401, V1 400 for unknown input, `product.manage`, executor wiring, no old `adjustStockByAdmin` import/call/export, and no order/history fan-out in the executor.

- [ ] **Step 2: Run route/source tests and verify RED**

Expected: old route contract and legacy function make tests fail.

- [ ] **Step 3: Cut over the route and delete the legacy export**

Use `contractOk`/`contractFail`, `resolveAdminAccessContext`, typed command errors, sanitized 500 logging, and preserve every unrelated inventory route.

- [ ] **Step 4: Run route/source tests and verify GREEN**

Expected: route and source-contract tests pass.

### Task 4: Admin request and conflict interaction

**Files:**
- Modify: `apps/admin/src/features/inventory/overview/api.ts`
- Modify: `apps/admin/src/features/inventory/overview/api.test.ts`
- Create: `apps/admin/src/features/inventory/overview/inventory-adjust-mutation.ts`
- Create: `apps/admin/src/features/inventory/overview/inventory-adjust-mutation.test.ts`
- Modify: `apps/admin/src/features/inventory/overview/InventoryOverviewPage.tsx`

**Interfaces:**
- Produces: `InventoryAdjustmentResult`, `adjustInventory(productId, expectedStock, adjustQuantity, reason, request, createIdempotencyKey)`, and `commitInventoryAdjustment(...)`.

- [ ] **Step 1: Write failing API and mutation tests**

Assert all four request fields, a fresh UUID on each invocation, success message plus refresh, 409 conflict message plus refresh without success, and propagation of non-conflict errors.

- [ ] **Step 2: Run tests and verify RED**

Expected: old three-argument API and direct page mutation fail the new tests.

- [ ] **Step 3: Implement API and mutation helper**

Generate `crypto.randomUUID()` at confirmation time and classify `AdminApiError` status/code without changing global error handling.

- [ ] **Step 4: Wire per-product pending state into the page**

Use `Set<string>` state, disable only the matching product’s adjustment button, pass the visible `item.stock`, call the mutation helper, refresh on success/409, and always clear pending state.

- [ ] **Step 5: Run Admin tests and typecheck**

Expected: API/helper tests and Admin typecheck pass.

### Task 5: Focused verifier, full gates, and publication

**Files:**
- Create: `scripts/verify-l50-c2-t3c-inventory-adjust-command-local.ts`
- Modify: task ledger only if the repository’s current ledger has a dedicated L50-C2-T3-C row.

- [ ] **Step 1: Add the focused verifier**

Run parser, executor, route, source-contract, Admin tests, API/Admin typechecks, and the isolated PostgreSQL integration command without editing shared dependency versions.

- [ ] **Step 2: Run focused verifier**

Expected: exit 0 with explicit parser, route, Admin, concurrency, idempotency, O(1), and rollback markers.

- [ ] **Step 3: Run full project gates**

Run:

```bash
pnpm verify:all
```

Then run the real Admin browser scenario and baseline audit defined by the repository workflow.

- [ ] **Step 4: Review scope and mutation protection**

Confirm every design requirement maps to a passing test, the executor has no order/history fan-out, excluded subsystems are unchanged, and realistic wrong-branch/missing-side-effect mutations are caught.

- [ ] **Step 5: Commit, push, and open a draft PR**

Publish on `codex/l50-c2-t3c-inventory-adjust-command` based on `80f1750e63ed183f3aa02a11384ad701ea8fc1de`, re-read the remote head after publication, then open a draft PR to `stable/l50-a3-4-business-base`.
