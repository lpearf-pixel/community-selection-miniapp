# Mini Program App-Service Actions Design

## Context

The real WeChat business E2E suite can read rendered nodes through the
App-Service page protocol, but interactive element handles are not stable in
the current DevTools protocol. The automator creates route-fallback elements
with synthetic IDs. Querying a generated product ID times out, while dispatching
`change` on a fallback picker never receives a protocol response.

Increasing timeouts or adding more selectors cannot repair that protocol
boundary. The page itself and its WXML handlers are healthy: rendered-node and
page-data probes complete before the failing interaction.

## Decision

Add a driver-owned rendered page action primitive. An action must:

1. Wait for the real WXML hook with `waitForRendered` and optional dataset
   evidence.
2. Invoke the WXML-bound page handler through `Page.callMethod`.
3. Pass the same event-shaped payload the handler receives from WXML.
4. Bound the invocation with the existing operation timeout and emit start and
   completion report events.
5. Fail closed when the page cannot call methods.

Page objects remain responsible for naming the exact handler and constructing
its event payload. They must not call `page.callMethod` directly; the driver
owns timeout, reporting, and capability checks.

## Scope

Migrate every interaction used by the three business scenarios:

- product direct buy;
- checkout fulfillment, delivery window, form inputs, and submit;
- order-detail after-sale navigation;
- after-sale reason and submit;
- group option pickers, minimum inputs, and create;
- group join;
- group-order inputs and submit.

The existing element `tap`, `input`, and `trigger` APIs remain available for
other suites. API business logic, WXML, and production page handlers do not
change.

## Error Handling

If `Page.callMethod` is unavailable, throw an `InfrastructureError` with code
`PAGE_METHOD_UNSUPPORTED`. A page action is never replayed after invocation,
because completion can be ambiguous after a protocol disconnect or timeout.

## Verification

- Unit-test that a rendered page action waits for WXML evidence, invokes the
  named method exactly once, and never queries an element.
- Contract-test that business page objects use the driver action bridge and do
  not call `page.callMethod` directly.
- Run the complete miniapp-testkit and project E2E contract suites plus both
  TypeScript checks.
- Treat the user's macOS WeChat run as the final integration proof.
