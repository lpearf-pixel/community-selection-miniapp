# Mini Program Async Submit Contract Design

## Context

The WeChat App-Service fallback executes page methods through an async
`App.callFunction` wrapper. The wrapper can await a returned promise, but the
checkout and group-create `submit()` handlers currently return `undefined`
after starting callback-driven requests. The first order request reaches the
API, while payment, navigation, and observable completion are detached from
the automation action.

The business suite also creates a random OpenID for the group leader even
though the API correctly requires an existing `leader` user, and cleanup reads
the order-list field `id` although that public DTO exposes `order_id`.

## Decision

1. Return the complete request/payment/navigation promise from checkout
   `submit()`.
2. Return a promise from group-create `submit()` that settles after the
   `wx.request` success or failure callback.
3. Use the seeded `leader-openid` identity only for creating a group without
   adding that shared identity to cleanup discovery; keep participant OpenIDs
   unique per run.
4. Normalize cleanup order references from `order_id ?? id` and discard empty
   identifiers.

## Constraints

- Do not bypass production pages with direct fixture API calls.
- Do not weaken the API leader-role check.
- Do not retry submit actions after dispatch.
- Preserve production UI behavior for real taps.
- Keep cleanup fail-closed for real API or refund failures.

## Verification

Unit tests must prove that both submit handlers return pending promises and
settle only after their asynchronous completion callbacks. Fixture tests must
cover `order_id` normalization, and a scenario contract must lock the seeded
leader identity. The full miniapp-testkit suite, project E2E contract suite,
and both TypeScript checks remain required before publication. The macOS
WeChat run is the final integration proof.
