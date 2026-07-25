# L50-C2-T3-A Reliable Refund Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public/cross-transaction MOCK refund path with one Admin-scoped, versioned, idempotent and atomic after-sale refund command.

**Architecture:** A small command parser owns request normalization and hashing. A refund executor reuses `AdminCommandReceipt`, order version CAS and one Prisma transaction that contains the after-sale transition plus every refund side effect. The Admin after-sales workbench calls only this route and never sends refund amounts during execution.

**Tech Stack:** Node.js 20+, TypeScript, Fastify 5, Prisma 6/PostgreSQL, React 18, Ant Design 5, Vitest 2, Playwright Admin E2E.

## Global Constraints

- Base branch is exactly `stable/l50-a3-4-business-base`.
- Refund execution amounts come only from approved server-side after-sale fields.
- `expected_version`, Admin-scoped `idempotency_key`, permission and current data scope are mandatory.
- All refund, order, inventory, credit, commission, event, timeline, audit, after-sale and receipt writes are one PostgreSQL transaction.
- MOCK success is allowed only when MOCK mode is explicit; non-MOCK mode is fail-closed.
- Do not implement real WeChat refund, withdrawal, generic inventory adjustment or delivery cancellation.
- E2E creates real orders and after-sale cases; it does not intercept the write API with a fake response.

---

### Task 1: Lock the command contract with RED tests

**Files:**
- Create: `apps/api/src/modules/refund/admin-refund-command.test.ts`
- Create: `apps/api/src/modules/refund/admin-refund-command.ts`
- Create: `scripts/admin-e2e/l50-c2-refund-source-contract.test.cjs`
- Modify: `.github/workflows/l50-c2-t3a-refund-gate.yml` only as a temporary task workflow

**Interfaces:**
- Produces: `AdminRefundCommand`, `AdminRefundResult`, `parseAdminRefundCommand(raw)`, `buildAdminRefundRequestHash(input)`.
- Consumes: C1 expected-version/idempotency conventions and Node `createHash('sha256')`.

- [ ] **Step 1: Add parser tests before production code**

The test cases must directly call the real parser and assert literal results:

```ts
expect(parseAdminRefundCommand({
  expected_version: 7,
  idempotency_key: 'admin-refund-12345678',
  admin_remark: '  审核通过  ',
})).toEqual({
  ok: true,
  value: {
    expected_version: 7,
    idempotency_key: 'admin-refund-12345678',
    admin_remark: '审核通过',
  },
});
```

Separate tests reject zero/float versions, short or oversized keys, missing/oversized remarks and any of `refund_amount_cents`, `product_refund_amount_cents`, `delivery_refund_amount_cents`.

- [ ] **Step 2: Add hash behavior tests**

Use literal fixtures to prove identical normalized inputs hash equally and that changing case ID, order ID, expected version, remark or any server-approved amount changes the hash.

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/refund/admin-refund-command.test.ts
node --test scripts/admin-e2e/l50-c2-refund-source-contract.test.cjs
```

Expected: parser test fails because the module does not exist; source contract fails because the route and executor do not exist. Do not start PostgreSQL or the full repository gate in RED.

- [ ] **Step 4: Implement the minimal parser and types**

```ts
export type AdminRefundCommand = {
  expected_version: number;
  idempotency_key: string;
  admin_remark: string;
};

export type AdminRefundResult = {
  after_sale_case_id: string;
  order_id: string;
  refund_id: string;
  refund_status: 'success';
  refund_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  remaining_refundable_amount_cents: number;
  order_status: string;
  version: number;
  execution_mode: 'mock';
};
```

The hash input additionally contains the after-sale ID, order ID and three approved server-side amounts. JSON serialization uses a fixed field order.

- [ ] **Step 5: Run GREEN for parser tests**

Run the same focused Vitest command. Expected: all parser/hash tests pass; source contract remains RED until later tasks.

- [ ] **Step 6: Commit**

Commit message: `test(refund): lock reliable command contract`.

### Task 2: Make refund domain writes join one caller transaction

**Files:**
- Modify: `apps/api/src/services/refund-service.ts`
- Modify: `apps/api/src/modules/after-sale/after-sale-service.ts`
- Create: `apps/api/src/services/refund-service.integration.test.ts`

**Interfaces:**
- Produces: `applyMockRefundInTransaction(tx, input)`.
- Consumes: `Prisma.TransactionClient`, existing split validation, inventory restoration, consumer credit return, commission sync, business event and timeline services.

- [ ] **Step 1: Write a rollback integration test**

Create a real paid order with inventory/credit/commission fixtures. Call the transaction helper with an injected failure after the order financial update. Assert literal zero changes to refund rows, order totals/version, stock ledger, consumer credit ledger, commission rows, events, timeline and audit after the rejected transaction.

- [ ] **Step 2: Write success and duplicate tests**

Success asserts one refund and every intended side effect. Duplicate internal `client_refund_id` with identical input returns the same refund; mismatched order or amounts rejects.

- [ ] **Step 3: Run RED on PostgreSQL**

```bash
pnpm db:generate
pnpm --filter @community-selection/api test -- src/services/refund-service.integration.test.ts
```

Expected: fails because `applyMockRefundInTransaction` is not exported.

- [ ] **Step 4: Extract the transaction-aware helper**

Move the current `createMockRefund()` transaction body behind:

```ts
export async function applyMockRefundInTransaction(
  tx: Prisma.TransactionClient,
  input: RefundInput & { expected_order_version?: number },
): Promise<Refund>
```

The helper never opens a nested transaction. `createMockRefund()` remains a compatibility wrapper that calls `prisma.$transaction(tx => applyMockRefundInTransaction(tx, input))` until Task 4 removes external callers.

- [ ] **Step 5: Make order update conditional**

When `expected_order_version` is supplied, update the order with `id + version + prior refund totals`, increment `version`, and throw a typed version conflict if `count !== 1`. Do this before irreversible-looking domain side effects, while remaining in the same transaction.

- [ ] **Step 6: Remove implicit refund execution from after-sale resolution**

For `refund` and `partial_refund`, `resolveAfterSaleCase()` rejects with a stable message instructing callers to use the reliable refund command. Non-refund resolution types preserve their current single-domain behavior.

- [ ] **Step 7: Run GREEN**

Run the focused refund service integration test and existing after-sale tests. Expected: all pass with no warning output.

- [ ] **Step 8: Commit**

Commit message: `refactor(refund): expose atomic transaction primitive`.

### Task 3: Implement the Admin refund executor

**Files:**
- Create: `apps/api/src/modules/refund/admin-refund-executor.ts`
- Create: `apps/api/src/modules/refund/admin-refund-executor.integration.test.ts`
- Modify: `apps/api/src/modules/after-sale/after-sale-service.ts` only to export/reuse a transaction-scoped log helper if needed

**Interfaces:**
- Produces: `executeAdminRefundCommand(input): Promise<AdminRefundResult>` and `AdminRefundCommandError`.
- Consumes: Task 1 parser/hash, Task 2 transaction helper, `AdminAccessContext`, `AdminCommandReceipt`, audit service and data-scope guard.

- [ ] **Step 1: Write real behavior tests**

Use real PostgreSQL fixtures for: partial refund, full refund, same-key replay, same-key mismatch, two-key race with one success/one 409, old version, wrong scope, permission/scope loss on replay, amount drift, non-MOCK 503 and injected rollback.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @community-selection/api test -- src/modules/refund/admin-refund-executor.integration.test.ts
```

Expected: fails because the executor does not exist.

- [ ] **Step 3: Implement receipt and replay behavior**

Use operation `admin.after_sale.refund.execute.v1`. On replay, first load the current after-sale/order identity and recheck scope; then verify request hash, completed receipt metadata and response shape.

- [ ] **Step 4: Implement one transaction**

Within one `prisma.$transaction`:

```ts
receipt create
afterSale + order load and eligibility checks
afterSale.updateMany({ where: { id, status: 'approved' }, data: { status: 'processing' } })
applyMockRefundInTransaction(tx, { ...approvedAmounts, expected_order_version })
afterSale.update({ status: 'resolved', refund_id, resolved_at })
after-sale log + business event + order timeline + admin audit
receipt complete
```

If the after-sale CAS count or order CAS count is not one, map to a 409 with no committed writes.

- [ ] **Step 5: Run GREEN**

Run the executor integration test twice: once focused, once together with T1/T2 executor tests. Expected: all pass.

- [ ] **Step 6: Commit**

Commit message: `feat(refund): add reliable Admin executor`.

### Task 4: Expose one protected route and retire public writes

**Files:**
- Modify: `apps/api/src/routes/after-sales.ts`
- Modify: `apps/api/src/routes/refunds.ts`
- Create: `apps/api/src/routes/admin-refund-route.integration.test.ts`
- Modify: `apps/api/test/l4-routes.test.ts`
- Modify: `scripts/admin-e2e/l50-c2-refund-source-contract.test.cjs`

**Interfaces:**
- Produces: `POST /api/admin/after-sales/:id/refund-execute`.
- Consumes: `requireAdminPermissionV1(['after_sale.manage', 'refund.manage'])`, parser, executor and C1 contract envelope.

- [ ] **Step 1: Write route RED tests**

Assert 401 without identity, 403 without either permission, 403 cross-scope, 400 for client amount fields, 409 for version conflict, 503 non-MOCK, 200 success and 200 replay. Assert `POST /api/refunds/mock` and `POST /api/refunds/wechat/apply` are not registered.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @community-selection/api test -- src/routes/admin-refund-route.integration.test.ts test/l4-routes.test.ts
```

Expected: new Admin route is 404 and old public routes still exist.

- [ ] **Step 3: Register the V1 route**

Parse only `expected_version`, `idempotency_key`, `admin_remark`; pass request IP/user-agent to the executor. Map only known typed errors and hide unexpected internals behind `ADMIN_REFUND_EXECUTION_FAILED`.

- [ ] **Step 4: Retire public mutation routes**

Keep the real notify placeholder fail-closed. Remove public MOCK and apply registration. Keep consumer-visible refund state available through user order APIs and Admin-visible state through order detail/refund ledger.

- [ ] **Step 5: Run GREEN**

Run route, L4 and source-contract tests. Expected: all pass.

- [ ] **Step 6: Commit**

Commit message: `feat(refund): secure execution route`.

### Task 5: Add the Admin execution interaction

**Files:**
- Modify: `apps/admin/src/features/sales/after-sales/types.ts`
- Modify: `apps/admin/src/features/sales/after-sales/api.ts`
- Create: `apps/admin/src/features/sales/after-sales/api.test.ts`
- Create: `apps/admin/src/features/sales/after-sales/useRefundExecution.ts`
- Modify: `apps/admin/src/features/sales/after-sales/AfterSalesPage.tsx`
- Create or modify: `apps/admin/src/features/sales/after-sales/after-sales-page-structure.test.tsx`

**Interfaces:**
- Produces: `executeAfterSaleRefund(afterSaleId, expectedVersion, idempotencyKey, adminRemark)`.
- Consumes: V1 Admin JSON requester and server-provided `order.version`, approved split fields and execution availability.

- [ ] **Step 1: Write API RED test**

Assert the exact path, POST method and body containing only version, key and remark. Assert no amount field can appear in the typed call.

- [ ] **Step 2: Write page behavior RED tests**

A real rendered row shows “执行退款” only for `approved + refund/partial_refund + positive approved amount`. The approved amount is text, not an input. Pending execution disables the button; a 409 triggers reload rather than success.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @community-selection/admin test -- src/features/sales/after-sales
```

Expected: tests fail because the client/hook/action do not exist.

- [ ] **Step 4: Implement the client and hook**

Generate one stable idempotency key per user attempt, reuse it for network retry, and clear it only after success or a conflict refresh. Do not keep keys globally across different cases.

- [ ] **Step 5: Update types and page**

Add order version and approved split fields to the Admin response type. Replace refund-type “解决” execution with a dedicated button and a non-editable confirmation. Keep non-refund “解决” behavior.

- [ ] **Step 6: Run GREEN**

Run Admin focused tests and typecheck. Expected: all pass.

- [ ] **Step 7: Commit**

Commit message: `feat(admin): execute approved refunds safely`.

### Task 6: Prove the end-to-end boundary and finish the PR

**Files:**
- Modify: `scripts/admin-e2e/fixture.ts`
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`
- Modify: temporary `.github/workflows/l50-c2-t3a-refund-gate.yml`
- Delete before final head: temporary workflow only

**Interfaces:**
- Consumes: real API, PostgreSQL, Admin browser and branch verification audit.
- Produces: one auditable Draft PR for T3-A only.

- [ ] **Step 1: Add a real fixture and browser scenario**

Create a real paid order and after-sale case, approve a server-side amount, open two browser contexts and execute the same row concurrently. Assert network statuses are exactly one 200 and one 409, the order version increments once and one refund ledger row exists.

- [ ] **Step 2: Run focused GREEN**

```bash
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/l50-c2-refund-source-contract.test.cjs
pnpm --filter @community-selection/api test -- src/modules/refund src/routes/admin-refund-route.integration.test.ts
pnpm --filter @community-selection/admin test -- src/features/sales/after-sales
```

- [ ] **Step 3: Run full gates once on the final implementation SHA**

```bash
pnpm db:generate
pnpm verify:all
pnpm setup:admin:e2e
pnpm e2e:admin
```

Also run the portable baseline audit. Store long logs as workflow artifacts and expose only the summary in the job log.

- [ ] **Step 4: Review security and atomicity**

Review the full diff against the design. Critical/Important findings must be fixed with a new failing test before any completion claim.

- [ ] **Step 5: Delete the temporary workflow**

Only after the exact implementation SHA is green, delete the task-specific workflow. Verify the cleanup commit changes no implementation bytes.

- [ ] **Step 6: Create a Draft PR**

Base: `stable/l50-a3-4-business-base`. Head: `codex/l50-c2-t3a-refund-command`. Include exact tested SHA, run URLs, tests, known MOCK-only limitation and exclusions.

- [ ] **Step 7: Do not merge**

Leave the PR Draft until final checks and review are tied to the current remote head.
