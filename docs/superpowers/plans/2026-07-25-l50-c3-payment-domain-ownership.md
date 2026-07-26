# L50-C3 Payment Domain Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the payment-success transaction so Payment, Order, Inventory, and GroupBuy each own their writes while preserving the current normal-purchase and group-buy behavior.

**Architecture:** `markOrderPaid()` remains the synchronous PostgreSQL transaction coordinator. It loads and validates the payment context, then delegates writes to narrow Payment, Inventory, Order, and GroupBuy services; all delegates receive the same `Prisma.TransactionClient`, so failures still roll back the entire payment. A row lock on `GroupBuy` serializes progress recomputation for different orders paying the same group concurrently.

**Tech Stack:** Node.js 20+, TypeScript 5.7, Prisma 6.19.3, PostgreSQL, Vitest 2.1, pnpm workspace.

## Global Constraints

- Keep `markOrderPaid(orderId, paymentInfo)` and its return shape compatible.
- Keep `/api/payments/mock` response status, DTO, and existing Chinese error messages unchanged.
- Do not change Prisma schema, migrations, package manifests, lockfile, Admin, miniapp, refund, POS, or deployment infrastructure.
- Do not add MQ, outbox/inbox, Redis, microservices, or a second database transaction.
- Payment code may write only `Payment`; Order code may write only `Order`; GroupBuy code may write only `GroupBuy`; inventory continues to own `Product` and `StockLedger`.
- Preserve first-level “开团服务奖励” rules and existing commission ownership.
- Follow strict red-green-refactor: each production behavior is preceded by a test observed failing for the intended reason.

## File Map

- Create `apps/api/src/modules/payment/payment-record-service.ts`: locate and confirm Payment records.
- Create `apps/api/src/modules/payment/payment-record-service.test.ts`: Payment service behavior.
- Create `apps/api/src/modules/order/order-payment-service.ts`: atomically claim payment and own paid/grouped Order updates plus payment event/timeline recording.
- Create `apps/api/src/modules/order/order-payment-service.test.ts`: Order service behavior.
- Create `apps/api/src/modules/group-buy/group-buy-payment-service.ts`: lock and recompute group progress, write GroupBuy only.
- Create `apps/api/src/modules/group-buy/group-buy-payment-service.test.ts`: GroupBuy service behavior.
- Modify `apps/api/src/services/payment-service.ts`: transaction coordinator only.
- Create `apps/api/src/services/payment-domain-ownership.contract.test.ts`: executable source ownership boundary.
- Create `apps/api/src/services/payment-domain-ownership.integration.test.ts`: PostgreSQL behavior, concurrency, and rollback.
- Create `scripts/verify-l50-c3-payment-domain-ownership.mjs`: focused release verifier.
- Modify `scripts/verify-all-local.sh`: register the focused verifier.
- Modify the current L50 task ledger if it contains a dedicated C3 entry.

---

### Task 1: Payment Record Owner

**Files:**
- Create: `apps/api/src/modules/payment/payment-record-service.test.ts`
- Create: `apps/api/src/modules/payment/payment-record-service.ts`

**Interfaces:**
- Produces:

```ts
export type PaymentInfo = {
  payment_id?: string;
  out_trade_no?: string;
  transaction_id?: string;
  raw_notify?: Prisma.InputJsonValue;
};

export function findPaymentForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  info: PaymentInfo,
): Promise<Payment | null>;

export function confirmPaymentRecordPaid(
  tx: Prisma.TransactionClient,
  payment: Payment | null,
  info: PaymentInfo,
): Promise<Payment | null>;
```

- [ ] **Step 1: Write failing Payment owner tests**

Use a complete transaction-client fake for `payment.findUnique`, `payment.findFirst`, and `payment.update`. Assert literal queries for payment ID, out-trade number, and latest order payment. Assert `null` is preserved and an existing `transaction_id` is never overwritten.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/payment/payment-record-service.test.ts
```

Expected: FAIL because `payment-record-service.js` does not exist.

- [ ] **Step 3: Implement the Payment owner**

Implement the exact lookup precedence `payment_id` → `out_trade_no` → latest `order_id`. Update only `trade_state`, missing `transaction_id`, and explicitly supplied `raw_notify`.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2. Expected: all Payment owner tests PASS.

- [ ] **Step 5: Checkpoint**

Review the diff and confirm the file contains no `tx.order`, `tx.groupBuy`, `tx.product`, or `tx.stockLedger`.

### Task 2: Order Payment Owner

**Files:**
- Create: `apps/api/src/modules/order/order-payment-service.test.ts`
- Create: `apps/api/src/modules/order/order-payment-service.ts`

**Interfaces:**
- Produces:

```ts
export function claimOrderPayment(
  tx: Prisma.TransactionClient,
  orderId: string,
  paidAt: Date,
): Promise<{ claimed: boolean; order: Order }>;

export function setPaidOrderStatus(
  tx: Prisma.TransactionClient,
  orderId: string,
  status: OrderStatus.paid | OrderStatus.grouped,
): Promise<Order>;

export function markGroupPaidOrdersGrouped(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
): Promise<number>;

export function recordPaidOrderEffects(
  tx: Prisma.TransactionClient,
  input: {
    beforeOrder: Order;
    paidOrder: Order;
    paymentId: string | null;
    transactionId: string | null;
    groupBuyId: string | null;
    groupStatus: string | null;
  },
): Promise<void>;
```

- [ ] **Step 1: Write failing Order owner tests**

Assert that `claimOrderPayment()` performs `updateMany({ id, pay_status: 'unpaid' })`, returns the latest Order when the claim count is zero, and throws `订单不存在` only if no latest Order exists. Assert exact `paid`/`grouped` updates, valid paid-order batch criteria, and existing event/timeline types and title.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/order/order-payment-service.test.ts
```

Expected: FAIL because `order-payment-service.js` does not exist.

- [ ] **Step 3: Implement the Order owner**

Keep every Order mutation and the payment event/timeline construction in this module. Do not query or update Payment, GroupBuy, Product, StockLedger, Commission, or AuditLog.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2. Expected: all Order owner tests PASS.

- [ ] **Step 5: Checkpoint**

Confirm wrong status, missing side effects, or removing the conditional `pay_status` predicate would fail at least one test.

### Task 3: GroupBuy Payment Owner

**Files:**
- Create: `apps/api/src/modules/group-buy/group-buy-payment-service.test.ts`
- Create: `apps/api/src/modules/group-buy/group-buy-payment-service.ts`

**Interfaces:**
- Produces:

```ts
export type GroupBuyPaymentProgress = {
  group_buy_id: string;
  status: string;
  paid_quantity: number;
  paid_people: number;
  target_count: number;
  is_success: boolean;
  became_success: boolean;
};

export function refreshGroupBuyAfterPayment(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
  now: Date,
): Promise<GroupBuyPaymentProgress | null>;
```

- [ ] **Step 1: Write failing GroupBuy owner tests**

Assert the row lock executes before aggregate reads; use literal fixtures for pending-below-target, pending-at-target, already-success, expired, failed, and missing group. Assert the owner writes only GroupBuy progress/status and emits `group_buy_success_refreshed` only on the first success transition.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/group-buy/group-buy-payment-service.test.ts
```

Expected: FAIL because `group-buy-payment-service.js` does not exist.

- [ ] **Step 3: Implement lock and absolute recomputation**

Use:

```ts
await tx.$queryRaw`
  SELECT id FROM "GroupBuy" WHERE id = ${groupBuyId} FOR UPDATE
`;
```

Then read the current GroupBuy, aggregate valid paid Orders, and update only GroupBuy. Return `became_success: true` only for `pending` → `success`.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2. Expected: all GroupBuy owner tests PASS.

- [ ] **Step 5: Checkpoint**

Confirm `group-buy-payment-service.ts` contains no `tx.order.update` or `tx.order.updateMany`.

### Task 4: Payment Transaction Coordinator

**Files:**
- Create: `apps/api/src/services/payment-domain-ownership.contract.test.ts`
- Modify: `apps/api/src/services/payment-service.ts`

**Interfaces:**
- Consumes the three owner services from Tasks 1–3 plus:

```ts
deductInventoryForPaidOrder(tx, { order, operator_user_id });
ensureEstimatedCommission(orderId, tx);
```

- Produces the existing `markOrderPaid(orderId, paymentInfo)` API.

- [ ] **Step 1: Write the failing ownership contract**

Load the production coordinator and owner source files. Fail if the coordinator contains direct `tx.payment.update`, `tx.order.update`, `tx.order.updateMany`, `tx.groupBuy.update`, `tx.product.update`, or `tx.stockLedger.create`. Require imports/calls for all four domain owners. Fail if any new owner writes a foreign domain.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/services/payment-domain-ownership.contract.test.ts
```

Expected: FAIL on the existing direct Payment, Order, and GroupBuy writes.

- [ ] **Step 3: Refactor `markOrderPaid()`**

Use one `paidAt` and one Prisma transaction. Preserve validation messages, duplicate notification behavior, inventory-before-claim ordering, conditional claim handling, normal order status, group recomputation, grouped batch update, commission estimation, and the existing audit payload.

- [ ] **Step 4: Verify GREEN and focused regressions**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/modules/payment/payment-record-service.test.ts \
  src/modules/order/order-payment-service.test.ts \
  src/modules/group-buy/group-buy-payment-service.test.ts \
  src/services/payment-domain-ownership.contract.test.ts
pnpm --filter @community-selection/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

### Task 5: PostgreSQL Concurrency and Rollback Proof

**Files:**
- Create: `apps/api/src/services/payment-domain-ownership.integration.test.ts`

**Interfaces:**
- Consumes the public `markOrderPaid()` API and real Prisma client.

- [ ] **Step 1: Write integration tests with isolated fixtures**

Create unique users, category, product, community, store, normal orders, and group orders. Cover normal payment, below-target group, target-reaching group, duplicate same-order payment, two different concurrent orders reaching target, insufficient inventory, and a PostgreSQL trigger that forces a post-update AuditLog failure.

- [ ] **Step 2: Verify RED/behavioral sensitivity**

Before relying on the new implementation, run the test against the old coordinator or temporarily disable the GroupBuy lock assertion. Confirm the concurrent convergence test fails or the ownership contract remains red; restore the intended implementation immediately afterward.

- [ ] **Step 3: Run the real PostgreSQL integration**

Run:

```bash
pnpm --filter @community-selection/api test -- \
  src/services/payment-domain-ownership.integration.test.ts
```

Expected: 0 failures; inventory, payment, order, group progress, timeline, commission, and audit rollback assertions all hold.

### Task 6: Release Verifier and Ledger

**Files:**
- Create: `scripts/verify-l50-c3-payment-domain-ownership.mjs`
- Modify: `scripts/verify-all-local.sh`
- Modify: current L50 ledger file only if a C3 row exists.

- [ ] **Step 1: Write the verifier**

Run the four focused unit/contract tests, the PostgreSQL integration test, and API typecheck. The verifier must propagate non-zero exits and must not grep prose as proof of runtime behavior.

- [ ] **Step 2: Register and run focused verification**

Run:

```bash
node scripts/verify-l50-c3-payment-domain-ownership.mjs
```

Expected: focused tests and typecheck PASS.

- [ ] **Step 3: Run repository gates**

Run, in order:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:all
```

Expected: every command exits 0. Use the `community` self-hosted Runner for Docker, real browser, and 61-item audit gates that are unavailable locally; keep one heavy job active at a time and avoid high-frequency API polling.

- [ ] **Step 4: Update the task ledger**

Record the exact implementation and verified head, note that this C3 slice governs only the payment-success write chain, and retain refund/after-sale/purchase/withdrawal cross-module ownership as future C3 work.

## Self-Review

- Spec coverage: Tasks 1–5 cover all Payment, Inventory, Order, GroupBuy, Commission, idempotency, concurrency, rollback, compatibility, and ownership requirements; Task 6 covers release gates and ledger.
- Placeholder scan: no TBD/TODO, generic “handle errors,” or undefined “similar to” steps remain.
- Type consistency: `PaymentInfo`, `GroupBuyPaymentProgress`, owner function names, Order status enum values, and coordinator calls are identical across producing and consuming tasks.
- Scope check: real WeChat payment, POS, outbox/inbox, schema changes, frontends, and unrelated cross-module chains remain explicitly excluded.
