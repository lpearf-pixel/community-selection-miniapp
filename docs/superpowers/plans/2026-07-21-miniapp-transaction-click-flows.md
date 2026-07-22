# Mini Program Transaction Click Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible WeChat DevTools click tests for ordinary purchase and group-buy business closures while keeping real payment and administrator actions outside the consumer UI.

**Architecture:** A macOS-only Automator runner performs real Mini Program taps and inputs. A small Node control-plane helper calls existing MOCK payment, order status and MOCK refund APIs for cross-role transitions, and every transition is re-read from the public user/group APIs before the scenario advances. Linux-runnable contract tests lock selectors, routes, identity switching and API-envelope handling.

**Tech Stack:** WeChat native Mini Program, `miniprogram-automator`, Node.js CommonJS, Node test runner, existing Fastify MOCK APIs and Docker Compose.

## Global Constraints

- Use `MOCK_WECHAT_PAY=true`; do not claim real WeChat payment or refund coverage.
- Consumer actions use Mini Program taps and inputs; fulfillment and refund processing use existing controlled APIs.
- Cover ordinary store pickup and delivery as separate orders.
- Cover group creation, two distinct paid participants, group success and fulfillment.
- Do not change payment, refund, inventory, reward or fulfillment business rules.
- Backend product CRUD is out of this plan; its current placeholder state is recorded as a separate P0 gap.

---

### Task 1: Stable Click Selectors and User Identity

**Files:**
- Modify: `apps/miniapp/pages/products/index.wxml`
- Modify: `apps/miniapp/pages/orders/confirm/index.wxml`
- Modify: `apps/miniapp/pages/orders/detail/index.wxml`
- Modify: `apps/miniapp/pages/after-sales/apply/index.wxml`
- Modify: `apps/miniapp/pages/start-group-buy/index.wxml`
- Modify: `apps/miniapp/pages/group-buy-detail/index.wxml`
- Modify: `apps/miniapp/pages/join-order/index.wxml`
- Modify: `apps/miniapp/pages/join-order/index.js`
- Test: `scripts/miniapp-e2e/business-flow.test.cjs`

**Interfaces:**
- Consumes: existing WXML tap/input handlers and `utils/user.getCurrentUser()`.
- Produces: stable `data-testid` selectors and group order payloads using the active test user's OpenID.

- [x] **Step 1: Write the failing selector/identity contract**

Create tests that require selectors for ordinary buy, pickup/delivery choice, checkout submit, after-sale application, group creation/join and group order submit. Require `join-order/index.js` to import and use `getCurrentUser()` instead of the literal `customer-openid`.

- [x] **Step 2: Run the contract and verify RED**

Run: `node --test scripts/miniapp-e2e/business-flow.test.cjs`

Expected: FAIL listing missing business-flow selectors and hard-coded group participant identity.

- [x] **Step 3: Add selectors and switch group participant identity**

Add only `data-testid` attributes to existing controls. In `join-order/index.js`, resolve `const user = getCurrentUser()` and send `user_id: user.user_id || undefined` plus `user_openid: user.openid`.

- [x] **Step 4: Run the contract and verify GREEN**

Run: `node --test scripts/miniapp-e2e/business-flow.test.cjs`

Expected: all selector and identity tests pass.

### Task 2: Business Flow Control Plane and Automator Runner

**Files:**
- Create: `scripts/miniapp-e2e/business-flow-lib.cjs`
- Create: `scripts/miniapp-e2e/business-flow.cjs`
- Modify: `scripts/miniapp-e2e/business-flow.test.cjs`

**Interfaces:**
- Consumes: `resolveMiniappApiBaseUrl()`, `launchDevTools()`, public catalog/location/group/order APIs, `POST /api/orders/:id/status`, `POST /api/refunds/mock`.
- Produces: `apiRequest()`, `waitForPagePath()`, `waitForPageData()`, `advanceOrder()`, fixture normalizers and the two click scenarios.

- [x] **Step 1: Write failing helper tests**

Cover API envelope success/failure, location normalization, order/group assertions, legal fulfillment sequences and deterministic client IDs.

- [x] **Step 2: Run helper tests and verify RED**

Run: `node --test scripts/miniapp-e2e/business-flow.test.cjs`

Expected: FAIL because `business-flow-lib.cjs` does not exist.

- [x] **Step 3: Implement the minimal helper module**

Implement injected-fetch API calls, state assertions and these sequences:

```js
const STORE_SEQUENCE = ['preparing', 'ready', 'picked', 'completed'];
const DELIVERY_SEQUENCE = ['preparing', 'ready', 'delivered', 'completed'];
```

- [x] **Step 4: Implement ordinary purchase click flow**

Use a unique customer identity, seed community/pickup-store selection, tap an active product's direct-buy button, tap checkout submit, assert MOCK paid, advance and assert store pickup. Repeat with delivery selection, time-window and receiver inputs. From the completed pickup order tap after-sale, input a reason, submit, issue MOCK full refund through the control plane, and assert `order_status=refunded`, `refund_status=success`.

- [x] **Step 5: Implement group-buy click flow**

Set the leader identity, tap create group with target 2, capture the group ID, switch to two unique customer identities, tap join and submit for each, assert both paid orders and `GroupBuy.status=success`, then advance both orders through store fulfillment to completion.

- [x] **Step 6: Run tests and syntax checks**

Run:

```bash
node --test scripts/miniapp-e2e/business-flow.test.cjs
node --check scripts/miniapp-e2e/business-flow-lib.cjs
node --check scripts/miniapp-e2e/business-flow.cjs
```

Expected: all tests and syntax checks pass.

### Task 3: Command Integration and Runbook

**Files:**
- Modify: `scripts/miniapp-e2e/container-runner.cjs`
- Modify: `package.json`
- Modify: `docs/runbooks/miniapp-home-e2e.md`
- Test: `scripts/miniapp-e2e/business-flow.test.cjs`

**Interfaces:**
- Consumes: `business-flow.cjs` and existing Docker/DevTools launcher.
- Produces: `pnpm e2e:miniapp:business` and documented artifacts/result markers.

- [x] **Step 1: Add failing command-wiring tests**

Require package script `e2e:miniapp:business`, suite allow-list entry `business`, and runner mapping to `business-flow.cjs`.

- [x] **Step 2: Run and verify RED**

Run: `node --test scripts/miniapp-e2e/business-flow.test.cjs`

Expected: FAIL on missing package/runner wiring.

- [x] **Step 3: Wire the command and document execution**

Add:

```json
"e2e:miniapp:business": "node scripts/miniapp-e2e/container-runner.cjs --suite business"
```

Document prerequisites, MOCK boundary, success markers, logs/screenshots and the full-restart recovery step for WeChat DevTools module-cache changes.

- [x] **Step 4: Run all executable gates**

Run:

```bash
node --test scripts/miniapp-e2e/*.test.cjs
pnpm miniapp:theme:check
pnpm verify:l49:static
pnpm verify:miniapp:theme
```

Expected: all Node/static gates pass. The real click command remains a required Mac verification because Linux cannot launch WeChat DevTools.
