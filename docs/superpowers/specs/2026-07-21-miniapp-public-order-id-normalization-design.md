# Miniapp Public Order ID Normalization Design

## Context

The real WeChat business E2E flow now completes order creation, payment,
fulfillment, after-sale submission, delivery, and group-buy fulfillment. The
remaining failure is `POST /api/refunds/mock` returning `缺少退款必填字段` for
both the pickup-refund scenario and cleanup.

`GET /api/me/orders/:id` deliberately exposes the public field `order_id`.
`FixtureApi.getUserOrder()` currently casts that response to `OrderRecord`,
whose canonical identifier is `id`. `createFullMockRefund()` consequently
sends `order_id: undefined` even though the requested order was found.

## Decision

Normalize the public detail DTO at the `FixtureApi.getUserOrder()` boundary:

- derive the canonical identifier from `order_id`, falling back to legacy
  `id`;
- return both the original public fields and canonical `id`;
- reject an order detail response that contains neither identifier.

This keeps scenario, fulfillment, refund, and cleanup code on one internal
`OrderRecord` contract without changing the production API.

## Alternatives

1. Teach only `createFullMockRefund()` to read `id ?? order_id`. This fixes the
   observed refund call but leaves other `OrderRecord` consumers exposed to
   the same DTO mismatch.
2. Add an `id` alias to the production public API. This expands a stable user
   API solely for test-infrastructure compatibility and creates unnecessary
   application regression risk.

## Verification

Add a regression test whose mocked public detail response contains only
`order_id`. It must prove that `getUserOrder()` returns canonical `id` and that
the resulting record produces a refund request with the same non-empty order
identifier. Then run the complete miniapp testkit suite, project E2E contract
suite, and both TypeScript checks.

## Scope

Modify only:

- `tests/miniapp-e2e/src/fixture-api.ts`
- `tests/miniapp-e2e/test/fixture-api.test.ts`

The design and plan documents accompany the fix. No production route,
service, page, schema, or dependency changes are permitted.
