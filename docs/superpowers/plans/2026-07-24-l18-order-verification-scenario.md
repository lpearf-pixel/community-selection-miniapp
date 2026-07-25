# L18 Order Verification Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make L18 verify valid paid and unpaid store-pickup orders through one canonical scenario path while independently proving that a missing pickup store is rejected without an order write.

**Architecture:** Keep the repair inside the L18 integration verifier. A typed, script-local function captures valid product, user, community, and pickup-store fixtures; one intentionally raw request exercises the invalid missing-pickup boundary. Production order code remains unchanged.

**Tech Stack:** TypeScript, Fastify `app.inject`, Prisma 6.19.3, pnpm 9.15.4, Node.js 20.19.0, GitHub Actions self-hosted runner.

## Global Constraints

- Modify only `scripts/verify-l18-user-order-center-local.ts` after these design and plan documents.
- Do not change production API validation, routes, services, or Prisma schema.
- Reuse the existing `pickupStore`; do not create another fixture.
- Keep the valid paid and valid unpaid normal-order payloads on one scenario function.
- The invalid missing-pickup contract must require HTTP 400 and zero matching database rows.
- Do not migrate other local verification scripts in PR #105.
- Only the latest PR head's full gate is completion evidence.

---

### Task 1: Canonical L18 normal store-order scenario

**Files:**
- Modify: `scripts/verify-l18-user-order-center-local.ts`

**Interfaces:**
- Consumes: existing `product.id`, `user.id`, `community.id`, `pickupStore.id`, `json`, and `app.inject` inside `main`.
- Produces: script-local `NormalStoreOrderScenario` and `createNormalStoreOrder(scenario)` returning the successful normal-order response data.

- [ ] **Step 1: Confirm the existing RED**

Run the existing L18 verifier in the repository's migrated PostgreSQL test environment:

```bash
pnpm exec tsx scripts/verify-l18-user-order-center-local.ts
```

Expected: FAIL while creating `${prefix}-unpaid` with HTTP 400 and the API message `请选择自提点`. This is the existing CI failure and proves that the valid unpaid scenario is malformed before pickup-code behavior is reached.

- [ ] **Step 2: Add the missing-pickup negative contract before changing valid-order construction**

Add an intentionally raw request with a unique request ID and independently derived assertions:

```ts
const missingPickupRequestId = `${prefix}-missing-pickup`;
assert(
  await prisma.order.count({ where: { client_request_id: missingPickupRequestId } }) === 0,
  'missing-pickup scenario should start without an order'
);
const missingPickupOrder = await app.inject({
  method: 'POST',
  url: '/api/orders/normal',
  payload: {
    product_id: product.id,
    user_id: user.id,
    client_request_id: missingPickupRequestId,
    quantity: 1,
    community_id: community.id,
    receiver_name: '缺少自提点用户',
    receiver_phone: '13612340000'
  }
});
assert(missingPickupOrder.statusCode === 400, 'normal store order without pickup store should return 400');
assert(
  await prisma.order.count({ where: { client_request_id: missingPickupRequestId } }) === 0,
  'normal store order without pickup store should not be created'
);
```

This test catches a production regression that removes the mandatory-pickup validation or writes before rejecting. Do not route this invalid request through the valid-order function.

- [ ] **Step 3: Implement the typed valid-order scenario function**

Inside `main`, after creating `product`, add:

```ts
type NormalStoreOrderScenario = {
  clientRequestId: string;
  quantity: number;
  receiverName: string;
  receiverPhone: string;
};

const createNormalStoreOrder = async (scenario: NormalStoreOrderScenario) => json(await app.inject({
  method: 'POST',
  url: '/api/orders/normal',
  payload: {
    product_id: product.id,
    user_id: user.id,
    client_request_id: scenario.clientRequestId,
    quantity: scenario.quantity,
    pickup_store_id: pickupStore.id,
    community_id: community.id,
    receiver_name: scenario.receiverName,
    receiver_phone: scenario.receiverPhone
  }
}));
```

Replace the existing paid normal-order raw request with:

```ts
const normalOrder = await createNormalStoreOrder({
  clientRequestId: `${prefix}-normal`,
  quantity: 2,
  receiverName: '普通用户',
  receiverPhone: '13812340000'
});
```

Replace the malformed unpaid-order raw request with:

```ts
const unpaidOrder = await createNormalStoreOrder({
  clientRequestId: `${prefix}-unpaid`,
  quantity: 1,
  receiverName: '未支付用户',
  receiverPhone: '13712340000'
});
```

Keep the existing payment, ownership, privacy, after-sales, commission, and unpaid pickup-code assertions unchanged.

- [ ] **Step 4: Verify the focused L18 behavior**

Run:

```bash
pnpm exec tsx scripts/verify-l18-user-order-center-local.ts
```

Expected: exit 0 with `Compliance scan passed.` and `L18 user order center verification passed.`

Mutation check:

- removing `pickup_store_id` from `createNormalStoreOrder` must fail valid paid/unpaid setup;
- allowing missing pickup must fail the HTTP 400 assertion;
- writing an order before returning 400 must fail the zero-row assertion;
- paying the unpaid order must fail the pickup-code denial assertion.

- [ ] **Step 5: Review the exact remote diff**

Confirm that the implementation commit changes only `scripts/verify-l18-user-order-center-local.ts`, and that the PR still targets `stable/l50-a3-4-business-base`, remains Draft, and has not been merged.

- [ ] **Step 6: Verify the complete latest-head gate**

Require the latest SHA to pass the existing workflow in this order:

```text
Verify focused pickup contracts
Verify pickup writes on PostgreSQL
Verify complete repository
Set up Admin browser
Verify real Admin browser
```

If a new head replaces a run, discard the old run as evidence. If any step fails, inspect its first real failure before making another change.

- [ ] **Step 7: Commit the implementation**

Commit only after focused verification evidence is available:

```bash
git add scripts/verify-l18-user-order-center-local.ts
git commit -m "test(order): unify L18 store order scenarios"
```
