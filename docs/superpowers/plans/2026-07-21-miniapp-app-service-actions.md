# Mini Program App-Service Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real WeChat business E2E flow interact reliably when DevTools exposes only App-Service page protocol elements.

**Architecture:** `MiniappDriver.invoke` owns rendered evidence, timeout, reporting, and `Page.callMethod` dispatch. Business page objects supply the WXML handler name and event-shaped arguments while production pages remain unchanged.

**Tech Stack:** TypeScript, Vitest, WeChat native Mini Program, `@weapp-vite/miniprogram-automator` 1.2.7

## Global Constraints

- Preserve real WXML render evidence before every business action.
- Do not retry an action after dispatch starts.
- Do not change production business rules or API payloads.
- Do not call `page.callMethod` directly from project page objects.
- Keep existing element interaction APIs backward-compatible.

---

### Task 1: Driver-owned rendered page action

**Files:**
- Modify: `packages/miniapp-testkit/src/driver.ts`
- Test: `packages/miniapp-testkit/test/driver.test.ts`

**Interfaces:**
- Consumes: `MiniProgramPage.callMethod`, `ElementTarget`, `withTimeout`
- Produces: `MiniappDriver.invoke(page, target, method, ...args): Promise<void>`

- [ ] **Step 1: Write the failing test**

Add a test whose page exposes `waitForRendered`, `query`, and `callMethod`. Call:

```ts
await driver.invoke(page, {
  description: 'fixture picker',
  renderSelector: '.e2e-fixture-picker',
  dataset: { id: 'fixture-1' },
}, 'onFixtureChange', { detail: { value: '2' } });
```

Assert that rendered evidence is checked, `callMethod` is called once with the
handler and event, and `query` is never called.

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
./node_modules/.bin/vitest run packages/miniapp-testkit/test/driver.test.ts
```

Expected: TypeScript/Vitest failure because `MiniappDriver.invoke` is missing.

- [ ] **Step 3: Implement the minimal driver method**

Add a private rendered-evidence wait helper and:

```ts
async invoke(
  page: MiniProgramPage,
  target: ElementTarget,
  method: string,
  ...args: unknown[]
): Promise<void>
```

The method must wait for `target.renderSelector`, require `page.callMethod`, log
`page-action-start` / `page-action-complete`, and invoke the handler once through
`withTimeout`.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run the same focused Vitest command. Expected: all driver tests pass.

### Task 2: Migrate the business page objects

**Files:**
- Modify: `tests/miniapp-e2e/src/pages/products.page.ts`
- Modify: `tests/miniapp-e2e/src/pages/checkout.page.ts`
- Modify: `tests/miniapp-e2e/src/pages/order-detail.page.ts`
- Modify: `tests/miniapp-e2e/src/pages/after-sales.page.ts`
- Modify: `tests/miniapp-e2e/src/pages/group.page.ts`
- Modify: `tests/miniapp-e2e/test/page-objects.contract.test.ts`

**Interfaces:**
- Consumes: `MiniappDriver.invoke`
- Produces: event payloads matching the existing WXML handlers

- [ ] **Step 1: Write failing contract assertions**

Require page objects to contain `driver.invoke` and the exact handler names used
by their WXML: `goNormalBuy`, `selectPickupType`, `selectDeliveryTimeWindow`,
`onInput`, `submit`, `applyAfterSale`, `onProductChange`, `onCommunityChange`,
`onMinPeopleInput`, `onMinQuantityInput`, `join`, `onNameInput`, `onPhoneInput`,
and `onQuantityInput`.

- [ ] **Step 2: Run the project contract test to verify RED**

```bash
./node_modules/.bin/vitest run --config tests/miniapp-e2e/vitest.config.ts test/page-objects.contract.test.ts
```

Expected: assertions fail because page objects still use element actions.

- [ ] **Step 3: Replace business element actions with driver invocations**

Use payloads shaped like:

```ts
{ currentTarget: { dataset: { id: productId } } }
{ currentTarget: { dataset: { type: 'delivery' } } }
{ currentTarget: { dataset: { field: 'receiver_name' } }, detail: { value } }
{ detail: { value: String(index) } }
```

Capture the first delivery window from `waitForData` and dispatch its `code`.
Actions without an event call the handler with no arguments.

- [ ] **Step 4: Run focused project tests to verify GREEN**

Run the page-object contract test and the start-group-buy page behavior test.
Expected: all focused tests pass.

### Task 3: Full verification and publication

**Files:**
- Verify all files changed by Tasks 1 and 2 plus this spec and plan.

**Interfaces:**
- Consumes: repository test scripts and GitHub branch `codex/l49-brand-home-e2e`
- Produces: one fast-forward commit based on remote `2c29270a`

- [ ] **Step 1: Run all four local gates**

```bash
./node_modules/.bin/vitest run packages/miniapp-testkit/test
./node_modules/.bin/vitest run --config tests/miniapp-e2e/vitest.config.ts
./node_modules/.bin/tsc --noEmit -p packages/miniapp-testkit/tsconfig.json
./node_modules/.bin/tsc --noEmit -p tests/miniapp-e2e/tsconfig.json
```

- [ ] **Step 2: Audit the exact diff**

Confirm only the design, plan, driver, driver test, five page objects, and their
contract test differ from remote `2c29270a`.

- [ ] **Step 3: Publish atomically**

Re-read the remote branch HEAD. Create blobs, a tree, and one commit; re-check
HEAD immediately before a non-force ref update. Stop if the branch moved.

- [ ] **Step 4: Verify remote publication**

Confirm the branch points to the new commit, compare it to `2c29270a`, and verify
all changed remote blobs match the locally tested snapshot.
