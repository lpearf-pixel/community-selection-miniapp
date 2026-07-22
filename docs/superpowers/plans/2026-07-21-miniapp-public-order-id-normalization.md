# Miniapp Public Order ID Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize public `order_id` responses into the E2E fixture's canonical `OrderRecord.id` so real refund and cleanup requests carry a valid order identifier.

**Architecture:** Keep the production public API unchanged. Normalize the external DTO once in `FixtureApi.getUserOrder()`, then let existing fulfillment, refund, and cleanup consumers continue using `OrderRecord.id`.

**Tech Stack:** TypeScript 5.7, Vitest 2.1, Node.js 20/22, WeChat Mini Program E2E fixture API.

## Global Constraints

- Do not modify production API routes, services, pages, schemas, or dependencies.
- Preserve `order_id` in the returned object while adding canonical `id`.
- Reject public order details without either `order_id` or legacy `id`.
- Publish only by non-forced fast-forward if `codex/l49-brand-home-e2e` still points to the verified parent.
- Do not create a PR and do not merge.

---

### Task 1: Lock and implement the public order identifier boundary

**Files:**
- Modify: `tests/miniapp-e2e/test/fixture-api.test.ts`
- Modify: `tests/miniapp-e2e/src/fixture-api.ts`

**Interfaces:**
- Consumes: `FixtureApi.getUserOrder(orderId: string, openid: string): Promise<OrderRecord>` and public detail objects containing `order_id`.
- Produces: an `OrderRecord` that preserves `order_id` and always has a non-empty canonical `id`.

- [ ] **Step 1: Write the failing regression test**

Add a test that mocks `GET /api/me/orders/order-public-1` with:

```ts
{
  success: true,
  data: {
    order_id: 'order-public-1',
    pay_amount_cents: 3300,
    refund_amount_cents: 800,
  },
}
```

Assert that `getUserOrder()` returns both `id: 'order-public-1'` and
`order_id: 'order-public-1'`, then pass the result to
`createFullMockRefund()` and assert the POST body contains
`order_id: 'order-public-1'`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
repo/node_modules/.bin/vitest run --config repo/tests/miniapp-e2e/vitest.config.ts repo/tests/miniapp-e2e/test/fixture-api.test.ts
```

Expected: the new assertion fails because the returned record has no `id`, or
the refund body contains no `order_id`; existing fixture tests remain green.

- [ ] **Step 3: Implement boundary normalization**

Update `getUserOrder()` to load the raw object, derive:

```ts
const id = String(order.order_id ?? order.id ?? '').trim();
```

Throw `Order <requested id> response is missing an identifier` when empty;
otherwise return `{ ...order, id } as OrderRecord`.

- [ ] **Step 4: Run focused and complete verification**

Run:

```bash
repo/node_modules/.bin/vitest run --config repo/tests/miniapp-e2e/vitest.config.ts repo/tests/miniapp-e2e/test/fixture-api.test.ts
repo/node_modules/.bin/vitest run repo/packages/miniapp-testkit/test
repo/node_modules/.bin/vitest run --config repo/tests/miniapp-e2e/vitest.config.ts
repo/node_modules/.bin/tsc --noEmit -p repo/packages/miniapp-testkit/tsconfig.json
repo/node_modules/.bin/tsc --noEmit -p repo/tests/miniapp-e2e/tsconfig.json
```

Expected: all Vitest suites pass and both TypeScript commands exit with code 0.

- [ ] **Step 5: Publish the verified snapshot safely**

Confirm the remote branch still points to
`95a17442899e9ac0b85ea801e22ae0e3e9c89037`, create one commit containing
only the two code/test files and these two documents, then update the branch
with `force: false`. Re-fetch all four blobs and compare them with the local
verified Git blob SHAs.
