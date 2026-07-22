# Reusable Mini Program Test Framework Implementation Plan

> **Execution mode:** Inline execution in this session with Red-Green-Refactor checkpoints.

**Goal:** Replace the Community Selection Mini Program business click script with an independently reusable test framework and a project-owned Vitest suite.

**Architecture:** `packages/miniapp-testkit` owns generic ports, driver policies, page-object primitives, lifecycle, reporting, artifacts, and a WeChat adapter. `tests/miniapp-e2e` owns Community Selection configuration, API fixtures, page objects, scenarios, and Vitest setup. The root command starts project services and invokes the project suite.

**Tech stack:** Node.js 22+, TypeScript 5.7, Vitest 2.1, `@weapp-vite/miniprogram-automator` 1.2.7, native WeChat Mini Program, Docker Compose.

## Task 1: Define the reusable package contract

**Files:**

- Create: `packages/miniapp-testkit/package.json`
- Create: `packages/miniapp-testkit/tsconfig.json`
- Create: `packages/miniapp-testkit/src/ports.ts`
- Create: `packages/miniapp-testkit/src/errors.ts`
- Create: `packages/miniapp-testkit/src/policy.ts`
- Create: `packages/miniapp-testkit/src/index.ts`
- Test: `packages/miniapp-testkit/test/policy.test.ts`

**Interfaces:**

- Produce `MiniProgramSession`, `MiniProgramPage`, `MiniProgramElement`, `OperationPolicy`, `InfrastructureError`, `BusinessAssertionError`, `withTimeout`, and `retryInfrastructure`.
- `retryInfrastructure` retries only errors classified as infrastructure failures; it never retries `BusinessAssertionError`.

- [ ] Write tests proving operation timeouts, bounded attempts, infrastructure-only retries, and no business retry.
- [ ] Run `pnpm exec vitest run packages/miniapp-testkit/test/policy.test.ts` and observe failures caused by missing exports.
- [ ] Implement the minimal ports, errors, timeout, and retry policy.
- [ ] Re-run the focused test and require zero failures.

## Task 2: Add driver, page-object, lifecycle, and reporting primitives

**Files:**

- Create: `packages/miniapp-testkit/src/driver.ts`
- Create: `packages/miniapp-testkit/src/page-object.ts`
- Create: `packages/miniapp-testkit/src/lifecycle.ts`
- Create: `packages/miniapp-testkit/src/reporter.ts`
- Create: `packages/miniapp-testkit/test/driver.test.ts`
- Create: `packages/miniapp-testkit/test/lifecycle.test.ts`
- Create: `packages/miniapp-testkit/test/reporter.test.ts`

**Interfaces:**

- `MiniappDriver.waitForRoute(path)`, `waitForElement(selector, dataset)`, `tap`, `input`, `readData(path)`, and `captureFailure`.
- `MiniappPageObject.open()`, `tapAndWait()`, and `input()` delegate to the driver.
- `runScenarioLifecycle(body, cleanup[])` preserves the body error and attaches cleanup errors.
- `JsonLineReporter.step()` writes immediately and `flush()` produces the final report.

- [ ] Write driver tests using in-memory pages to prove route waiting, rendered-dataset matching, element fallback, explicit timeouts, and no retry around taps.
- [ ] Write lifecycle tests proving LIFO cleanup and primary-error preservation.
- [ ] Write reporter tests proving immediate JSON-lines output and deterministic artifact names.
- [ ] Run the three focused tests and observe missing-module failures.
- [ ] Implement only the behaviors required by the failing tests.
- [ ] Run all package tests and require zero failures.

## Task 3: Add the WeChat adapter and independent package gates

**Files:**

- Create: `packages/miniapp-testkit/src/wechat-adapter.ts`
- Create: `packages/miniapp-testkit/README.md`
- Create: `packages/miniapp-testkit/test/package-boundary.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- `WechatSessionFactory.connect({ wsEndpoint, timeoutMs })` and `.launch({ cliPath, projectPath, port, timeoutMs })` return the generic session port.
- The adapter maps generic query/read calls to the maintained automator's timeout and AppService fallback options.

- [ ] Write a package-boundary test forbidding Community Selection paths, routes, selectors, and business vocabulary in `src` except the adapter package name.
- [ ] Write adapter contract tests with an injected launcher proving connect/launch options and session mapping.
- [ ] Run the focused tests and observe failures from missing adapter/package configuration.
- [ ] Add `@weapp-vite/miniprogram-automator@1.2.7`, implement the adapter, README, build, test, and type-check scripts.
- [ ] Run package test, type-check, and build gates.

## Task 4: Build the Community Selection fixture and page-object layer

**Files:**

- Create: `tests/miniapp-e2e/vitest.config.ts`
- Create: `tests/miniapp-e2e/src/config.ts`
- Create: `tests/miniapp-e2e/src/fixture-api.ts`
- Create: `tests/miniapp-e2e/src/project-session.ts`
- Create: `tests/miniapp-e2e/src/pages/products.page.ts`
- Create: `tests/miniapp-e2e/src/pages/checkout.page.ts`
- Create: `tests/miniapp-e2e/src/pages/order-detail.page.ts`
- Create: `tests/miniapp-e2e/src/pages/after-sales.page.ts`
- Create: `tests/miniapp-e2e/src/pages/group.page.ts`
- Create: `tests/miniapp-e2e/test/page-objects.contract.test.ts`
- Create: `tests/miniapp-e2e/test/fixture-api.test.ts`

**Interfaces:**

- `FixtureApi.loadBusinessFixture()` returns normalized product, community, and pickup point records.
- `FixtureApi` preserves HTTP status/path on errors and ignores only missing-user 404 during cleanup.
- Each page object owns one route and its stable selectors; `ProductsPage.buy(product)` filters by unique product name and verifies the rendered button dataset before tapping.

- [ ] Write fixture API tests for envelope handling, fixture pairing, user-scoped order discovery, 404 cleanup tolerance, and 500 propagation.
- [ ] Write source/behavior contracts for the seven page objects and their route transitions.
- [ ] Run project contract tests and observe missing-module failures.
- [ ] Implement config, fixture client, session adapter, and page objects.
- [ ] Re-run project contract tests and require zero failures.

## Task 5: Migrate the three business scenarios

**Files:**

- Create: `tests/miniapp-e2e/src/scenario-context.ts`
- Create: `tests/miniapp-e2e/src/scenarios/ordinary-pickup-refund.ts`
- Create: `tests/miniapp-e2e/src/scenarios/ordinary-delivery.ts`
- Create: `tests/miniapp-e2e/src/scenarios/group-buy.ts`
- Create: `tests/miniapp-e2e/test/business.e2e.test.ts`
- Create: `tests/miniapp-e2e/test/scenarios.contract.test.ts`

**Interfaces:**

- Each scenario accepts `ScenarioContext` and returns created order/group IDs.
- Consumer actions use page-object `tap`/`input`; admin-only status/refund changes use `FixtureApi` and are re-read through user APIs.
- Vitest runs scenarios serially in a shared session with per-scenario storage reset.

- [ ] Write scenario contracts for pickup/refund, delivery, two paid group participants, source-version probing, MOCK-only boundary, and success markers.
- [ ] Run contract tests and observe missing-scenario failures.
- [ ] Move existing verified business transitions into the three scenario modules without importing the old runner.
- [ ] Add Vitest lifecycle that starts once, probes once, restores per scenario, records artifacts, and cleans once.
- [ ] Re-run all Linux-runnable project tests and require zero failures.

## Task 6: Switch commands and retire the monolithic entrypoint

**Files:**

- Modify: `scripts/miniapp-e2e/container-runner.cjs`
- Modify: `package.json`
- Modify: `docs/runbooks/miniapp-home-e2e.md`
- Modify: `scripts/miniapp-e2e/business-flow.test.cjs`

**Interfaces:**

- `pnpm test:miniapp:e2e-framework` runs reusable-package and project contract gates.
- `pnpm e2e:miniapp:business` starts containers and invokes Vitest with the project config.
- The container runner maps `business` to a command array, not `business-flow.cjs`.

- [ ] Add failing command-wiring tests that reject the old business script entrypoint.
- [ ] Run the focused wiring test and observe failure.
- [ ] Switch the command and container runner, update the runbook, and mark the old script as legacy-only.
- [ ] Re-run wiring, framework, package type-check, theme, home-model, and L49 static gates.

## Task 7: Publish with evidence

**Files:** all files above.

- [ ] Review the final diff against the design acceptance criteria.
- [ ] Run fresh full verification and record exact pass counts and platform-limited gates.
- [ ] Re-read remote branch HEAD and stop if it moved from the expected base.
- [ ] Create an atomic Git commit on `codex/l49-brand-home-e2e` and update the ref by non-force fast-forward only.
- [ ] Fetch the new remote commit, compare changed files, and re-run the key local gates against the published content.
- [ ] Report the remote SHA and give one Mac command for the complete real-click run; do not claim real-click success until that command passes on WeChat DevTools.
