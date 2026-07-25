# L18 Order Verification Scenario Design

## Context

The L18 user-order-center verifier creates one valid paid store-pickup order through a complete payload, but creates its valid unpaid comparison order through a second handwritten payload that omits `pickup_store_id` and `community_id`. The production API correctly rejects that request with `400 请选择自提点`.

This is a verifier construction drift, not a production order validation defect. The same class of drift has already appeared in time and Admin-session setup, so the fix must remove the duplicate valid-order construction path while keeping this PR focused.

## Scope

This change is limited to `scripts/verify-l18-user-order-center-local.ts`.

It will:

- keep the production rule that every normal store-pickup order requires a valid pickup store;
- add one script-local `createNormalStoreOrder` scenario function;
- make the existing paid normal order and the valid unpaid normal order use that function;
- inject the already-created product, user, community, and pickup store from one place;
- keep scenario-specific inputs limited to request ID, quantity, receiver name, and receiver phone;
- add an explicit negative contract proving that omitting `pickup_store_id` returns HTTP 400 and creates no order.

It will not:

- change API routes, services, Prisma schema, or production validation;
- create a second pickup store;
- introduce a shared test framework in PR #105;
- migrate L10–L23 verification scripts.

## Design

### Valid store-pickup scenario

Inside `main`, after the fixture records exist, define a typed scenario input:

```ts
type NormalStoreOrderScenario = {
  clientRequestId: string;
  quantity: number;
  receiverName: string;
  receiverPhone: string;
};
```

`createNormalStoreOrder` captures the existing `product`, `user`, `community`, and `pickupStore` records and sends one canonical `/api/orders/normal` payload. Callers cannot accidentally omit the current store-pickup invariants.

The paid order keeps its existing payment call and assertions. The unpaid order is created through the same function but is intentionally not paid, so the pickup-code denial continues to test payment state rather than malformed fulfillment data.

### Missing-pickup negative contract

Send a separate raw request that deliberately omits `pickup_store_id`. This is the only raw normal-order request in the script and is visibly labeled as invalid.

Before the request, assert there is no order for its unique `client_request_id`. After the request:

- require status code 400;
- require that the same `client_request_id` still has zero orders.

The negative contract protects both the API response and the no-write side effect. It does not assert exact localized message text.

## Data Flow

1. Create category, community, pickup store, users, and product.
2. Build the script-local normal-order scenario function from those fixtures.
3. Create and pay the normal order through the function.
4. Exercise user order-list, detail, privacy, and after-sales behavior.
5. Create a valid unpaid order through the same function and verify pickup-code denial.
6. Send the intentionally invalid missing-pickup request and verify HTTP 400 plus zero database writes.
7. Run the existing compliance scan.

## Verification

The pre-fix RED is the existing L18 failure in PR #105: valid unpaid-order setup throws `400 请选择自提点` before the intended pickup-code assertion.

The change is complete only when the latest PR head passes:

- `scripts/verify-l18-user-order-center-local.ts` inside `pnpm verify:all`;
- the complete repository verification step;
- the real Admin browser step.

Old green runs and partial steps are not completion evidence.

## Follow-up Boundary

A separate follow-up task may extract shared API clients, Admin sessions, business scenario factories, and lifecycle management, then migrate L12–L23 in small batches. That work is intentionally excluded from PR #105.