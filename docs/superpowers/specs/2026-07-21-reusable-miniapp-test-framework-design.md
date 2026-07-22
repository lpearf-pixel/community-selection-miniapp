# Reusable Mini Program Test Framework Design

## Purpose

Replace the monolithic `scripts/miniapp-e2e/business-flow.cjs` runner with a reusable Mini Program end-to-end test framework. The framework must be independently buildable and testable, while the Community Selection project supplies only its own page objects, API fixtures, selectors, and business scenarios.

## Decisions

- Use Node.js 22 or newer and Vitest in serial mode.
- Use `@weapp-vite/miniprogram-automator@1.2.7` as the WeChat protocol adapter. It supplies protocol request timeouts, AppService fallbacks, rendered-node queries, and typed ESM APIs missing from `miniprogram-automator@0.12.1`.
- Keep the reusable core in `packages/miniapp-testkit` and the Community Selection suite in `tests/miniapp-e2e`.
- Keep Docker and local API startup in the project adapter. The reusable package never imports project paths, API routes, selectors, product fields, or order states.
- Keep real UI interaction as the consumer action. Page objects must invoke element `tap()` and `input()`; direct page methods are allowed only for non-consumer setup/refresh operations that cannot be represented as a user click.
- Retry only infrastructure reads and connection probes. Never retry business submissions or assertions.
- Run scenarios serially in one connected session. Each scenario owns a unique run identity and performs idempotent cleanup.
- Retain the first scenario failure. Screenshot, report, connection close, and cleanup failures are appended as diagnostics and cannot replace the primary error.

## Package Boundary

### `packages/miniapp-testkit`

The package contains:

- protocol-neutral `MiniProgramSession`, `MiniProgramPage`, and `MiniProgramElement` ports;
- operation timeout and infrastructure retry policies;
- a driver that waits for routes, rendered elements, and stable conditions;
- a base page-object class with `tap`, `input`, and route-transition helpers;
- scenario lifecycle orchestration with ordered cleanup and primary-error preservation;
- JSON-lines progress reporting and failure artifacts;
- the WeChat adapter backed by `@weapp-vite/miniprogram-automator`.

The package has its own `package.json`, `tsconfig.json`, public exports, README, unit tests, and type-check command. It contains no `community-selection`, `/api/products`, `product-normal-buy`, or order/group terminology.

### `tests/miniapp-e2e`

The project suite contains:

- configuration and the Docker/DevTools project launcher;
- an API fixture client and Community Selection cleanup rules;
- page objects for products, checkout, order detail, after-sales, group creation, group detail, and group checkout;
- ordinary pickup/refund, ordinary delivery, and two-participant group-buy scenarios;
- Vitest global setup/teardown and a serial business specification;
- selector/source contract tests that run on Linux without WeChat DevTools.

## Runtime Flow

1. The project command starts PostgreSQL and API containers and waits for health.
2. Vitest loads the project environment and connects to or launches WeChat DevTools.
3. A protocol capability probe verifies App readiness, current-page access, rendered-node lookup, screenshot support, and the source-contract version.
4. The fixture client selects a known active product, community, and pickup point; each customer and order created by the suite has a unique run ID.
5. Each scenario follows `wait route -> wait rendered element -> tap/input -> assert next route/state`.
6. Controlled API calls advance administrator-only fulfillment and MOCK refund transitions; the suite re-reads the consumer-visible state after every transition.
7. On failure, the reporter records the first error, current route, rendered WXML where available, screenshot path, and cleanup diagnostics.
8. Teardown restores storage/API overrides, cleans created orders, closes or disconnects the session, and flushes a machine-readable report.

## Stability Rules

- Element lookup uses a single stable `data-testid` selector plus rendered-node dataset matching. It does not depend on text, CSS layout, list position, a compound CSS selector, or full-page `Page.getData`.
- Route and element reads use explicit protocol timeouts. Infrastructure retries have a fixed maximum and delay; writes, taps, form submissions, and assertions execute once.
- The suite records a source contract string exposed by the Mini Program and refuses to run if DevTools has loaded an older build.
- The fixture product is filtered into the visible catalog using its unique name before lookup. Dataset matching confirms the button belongs to the selected product.
- Tests are serial and deterministic. Shared DevTools state is restored between scenarios.
- A failed cleanup is diagnostic only when a scenario already failed; it is a test failure when the scenario itself succeeded.

## Scenario Coverage

The first framework release preserves the existing intended business coverage:

- ordinary store-pickup purchase, paid assertion, fulfillment, after-sale submission, MOCK full refund, and refunded assertion;
- ordinary delivery purchase, receiver/time-window input, paid assertion, delivery fulfillment, and completion;
- group creation with target two, two distinct paid participants, group-success assertion, pickup fulfillment, and completion.

Real WeChat payment, payment callback, and real refund remain outside automated MOCK coverage and require a pre-release 0.01-yuan device check.

## Extraction Contract

`packages/miniapp-testkit` can later move to its own repository without changing Community Selection page objects or scenarios. Extraction requires only changing the workspace dependency to a package version. No project-owned file may be imported by the package.

## Acceptance Criteria

- `pnpm --filter @community-selection/miniapp-testkit test` passes.
- `pnpm --filter @community-selection/miniapp-testkit typecheck` passes.
- Linux-runnable project contracts prove the package has no project imports and page objects contain the required selectors/transitions.
- `pnpm test:miniapp:e2e-framework` runs all framework and project contract tests.
- `pnpm e2e:miniapp:business` runs the three scenarios in one invocation on macOS.
- Logs clearly identify every route, element, tap, assertion, artifact, and cleanup step.
- The old `business-flow.cjs` is no longer the command entrypoint.
