# Mini Program Async Submit Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real WeChat submit actions observable through the App-Service fallback while preserving business validation and cleanup safety.

**Architecture:** Production page handlers expose their existing async work as returned promises. The E2E fixture layer supplies a valid seeded leader and normalizes public order DTO identifiers without bypassing page behavior.

**Tech Stack:** WeChat native Mini Program JavaScript, TypeScript, Vitest, `@weapp-vite/miniprogram-automator` 1.2.7

## Global Constraints

- Keep API business rules unchanged.
- Never replay an ambiguous submit action.
- Use test-first RED/GREEN cycles for each contract.
- Publish one non-force fast-forward commit to `codex/l49-brand-home-e2e`.

---

### Task 1: Observable checkout submission

**Files:**
- Modify: `apps/miniapp/pages/orders/confirm/index.js`
- Create: `tests/miniapp-e2e/test/checkout-submit-page.test.ts`

**Interfaces:**
- Produces: `submit(): Promise<void> | undefined`, where valid submissions settle after payment and redirect.

- [ ] Add a VM test that asserts a valid submit returns a pending thenable.
- [ ] Verify RED because the current handler returns `undefined`.
- [ ] Return the existing request chain from `submit()`.
- [ ] Resolve the mocked order and payment requests and verify redirect plus GREEN.

### Task 2: Observable group creation and valid leader identity

**Files:**
- Modify: `apps/miniapp/pages/start-group-buy/index.js`
- Modify: `tests/miniapp-e2e/test/start-group-buy-page.test.ts`
- Modify: `tests/miniapp-e2e/src/scenarios/group-buy.ts`
- Modify: `tests/miniapp-e2e/src/scenario-context.ts`

**Interfaces:**
- Produces: group `submit(): Promise<void> | undefined`, seeded leader OpenID `leader-openid`, and opt-out cleanup tracking for shared identities.

- [ ] Extend the existing VM test to require a pending promise until `wx.request` succeeds.
- [ ] Add a scenario contract for `leader-openid` with cleanup opt-out and verify RED.
- [ ] Wrap the group-create request in a returned promise and use the seeded leader without scanning its historical orders.
- [ ] Verify navigation, completion, and GREEN.

### Task 3: Cleanup DTO normalization

**Files:**
- Modify: `tests/miniapp-e2e/src/fixture-api.ts`
- Modify: `tests/miniapp-e2e/test/fixture-api.test.ts`

**Interfaces:**
- Produces: cleanup references normalized from `order_id ?? id` with no `undefined` sentinel.

- [ ] Add a failing test using the public order-list DTO shape.
- [ ] Normalize and validate the identifier at the DTO boundary.
- [ ] Verify focused and full project tests.

### Task 4: Verification and publication

**Files:**
- Verify all files from Tasks 1-3 plus this spec and plan.

**Interfaces:**
- Consumes: remote branch HEAD `79ce36cb5763a5206a6a049d346605c1462e64cc`.
- Produces: one atomically published commit.

- [ ] Run miniapp-testkit tests, project tests, and both TypeScript checks.
- [ ] Audit exact changed paths and remote HEAD.
- [ ] Create blobs, tree, and commit; re-check HEAD immediately before `force:false` update.
- [ ] Compare remote publication and verify every changed blob.
