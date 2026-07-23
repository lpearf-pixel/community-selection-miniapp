# L50-A3.2 Sales, Fulfillment, and After-sales Feature Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing group-buy, failed-group closure, order, fulfillment-overview, and after-sales Admin views out of `AdminApp` into four isolated feature slices with typed APIs, local refresh/retry, and unchanged business behavior.

**Architecture:** `AdminApp` remains the authenticated composition root. It keeps the four slices mounted for the authenticated session and hides inactive slices so selected closure data, order context, errors, and other page-local state keep their existing navigation lifetime. Shell refresh targets only the active slice. Successful mutations that previously called the global refresh invoke one composition-root callback that refreshes all four extracted sales slices plus the remaining transitional legacy data; closure-workbench mutations retain their narrower existing reload behavior.

**Tech Stack:** React 18.3.1, Ant Design 5.23.0, TypeScript strict/noImplicitAny, Vite 6, Vitest 2, Node 20.19.0 or supported newer Node, pnpm 9.15.4, Playwright 1.61.1.

## Global Constraints

- Remote base is `stable/l50-a3-1-business-base` at merge commit `df40ca39f8cb28ae2f22ea29101281b47681e136`.
- Implementation branch is `codex/l50-a3-2-sales-fulfillment-feature-slice`.
- The reconstructed local A3.1 source is accepted only because all 12 A3.1 changed-path Blob SHAs match the remote checkpoint exactly.
- Do not change dependencies, `pnpm-lock.yaml`, Prisma schema, migrations, API routes, payloads, response envelopes, permissions, payment, refund, inventory behavior, miniapp, POS, or persistent business behavior.
- Preserve all 23 L49 navigation labels and order, `App === AdminApp`, Session Cookie behavior, same-origin `/api`, money formatting, prompts, button copy, table columns, and action payloads.
- Keep `GroupBuyManagementPage`, `OrdersPage`, `FulfillmentOverviewPage`, and `AfterSalesPage` mounted for the authenticated session; use `hidden`, not conditional unmounting, for their existing view keys.
- A slice failure must not disable Shell navigation or another feature.
- Shell refresh on an extracted view must request only that view's primary loader endpoint.
- A mutation that currently calls `refreshLegacyFeatures()` must call the shared `onMutationCommitted()` transition callback after its own success. The callback refreshes all four A3.2 slices and the remaining legacy features so cross-domain freshness does not regress.
- Failed-group closure actions that currently call only `loadClosureWorkbench()` must continue doing only that.
- Preserve the after-sales loss prompt default by passing the first current inventory product ID into `AfterSalesPage`; do not move inventory ownership into A3.2.
- Do not remove `refreshLegacyFeatures` yet. Remove only `/api/group-buys`, `/api/orders`, `/api/admin/fulfillment/overview`, and `/api/admin/after-sales` from it.
- Do not submit `reports/`, generated `dist/`, `node_modules`, or a temporary workflow in the final PR.

---

### Task 1: Define typed sales, fulfillment, and after-sales API boundaries

**Files:**
- Create: `apps/admin/src/features/sales/shared/types.ts`
- Create: `apps/admin/src/features/sales/group-buys/types.ts`
- Create: `apps/admin/src/features/sales/group-buys/api.ts`
- Create: `apps/admin/src/features/sales/group-buys/api.test.ts`
- Create: `apps/admin/src/features/sales/orders/types.ts`
- Create: `apps/admin/src/features/sales/orders/api.ts`
- Create: `apps/admin/src/features/sales/orders/api.test.ts`
- Create: `apps/admin/src/features/fulfillment/overview/types.ts`
- Create: `apps/admin/src/features/fulfillment/overview/api.ts`
- Create: `apps/admin/src/features/fulfillment/overview/api.test.ts`
- Create: `apps/admin/src/features/sales/after-sales/types.ts`
- Create: `apps/admin/src/features/sales/after-sales/api.ts`
- Create: `apps/admin/src/features/sales/after-sales/api.test.ts`

**Interfaces:**
- Consumes: `JsonRequester`, `adminJsonRequest`, `adminApiUrl`, and catalog `Product`.
- Produces: the exact current DTOs plus typed loaders and mutation functions. No API path or request body changes.

- [ ] **Step 1: Write failing loader contracts**

Create one test per boundary. The tests use a typed requester double only at the HTTP boundary and assert returned data, endpoint identity, signal forwarding, method, and JSON payload.

```ts
it('loads the existing group-buy endpoint', async () => {
  const signal = new AbortController().signal;
  const request = vi.fn(async <T>(): Promise<T> => [{ id: 'g1' }] as T) as JsonRequester;
  await expect(loadGroupBuys(request, signal)).resolves.toEqual([{ id: 'g1' }]);
  expect(request).toHaveBeenCalledWith('/api/group-buys', { signal });
});

it('loads the existing order endpoint', async () => {
  const request = vi.fn(async <T>(): Promise<T> => [{ id: 'o1' }] as T) as JsonRequester;
  await loadOrders(request);
  expect(request).toHaveBeenCalledWith('/api/orders', { signal: undefined });
});

it('loads the existing fulfillment overview endpoint', async () => {
  const request = vi.fn(async <T>(): Promise<T> => ({ today_group_buys: 1 }) as T) as JsonRequester;
  await loadFulfillmentOverview(request);
  expect(request).toHaveBeenCalledWith('/api/admin/fulfillment/overview', {
    signal: undefined,
  });
});

it('loads the existing after-sales endpoint', async () => {
  const request = vi.fn(async <T>(): Promise<T> => [{ id: 'a1' }] as T) as JsonRequester;
  await loadAfterSales(request);
  expect(request).toHaveBeenCalledWith('/api/admin/after-sales', {
    signal: undefined,
  });
});
```

Mutation tests must include these exact contracts:

```ts
expect(request).toHaveBeenCalledWith('/api/orders/o1/status', {
  method: 'POST',
  body: JSON.stringify({ next_status: 'ready' }),
});

expect(request).toHaveBeenCalledWith('/api/admin/orders/o1/pickup-verify', {
  method: 'POST',
  body: JSON.stringify({ admin_remark: '后台核销自提' }),
});

expect(request).toHaveBeenCalledWith('/api/admin/group-buys/g1/clone', {
  method: 'POST',
  body: expect.any(String),
});

expect(request).toHaveBeenCalledWith('/api/admin/after-sales/a1/add-note', {
  method: 'POST',
  body: JSON.stringify({ admin_note: '备注' }),
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
../../node_modules/.bin/vitest run \
  src/features/sales/group-buys/api.test.ts \
  src/features/sales/orders/api.test.ts \
  src/features/fulfillment/overview/api.test.ts \
  src/features/sales/after-sales/api.test.ts
```

from `apps/admin`.

Expected: fail because the four API boundaries do not exist.

- [ ] **Step 3: Move exact DTOs and implement loaders**

`features/sales/shared/types.ts` exports the current `GroupBuy` and `Order`. `group-buys/types.ts` exports `ClosureSummary`, `ManualRefundOrder`, `ManualRefundOrderResponse`, and:

```ts
export type ClosureWorkbenchData = {
  summary: ClosureSummary;
  refundOrders: ManualRefundOrder[];
};
```

The primary loaders are:

```ts
export function loadGroupBuys(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<GroupBuy[]> {
  return request<GroupBuy[]>('/api/group-buys', { signal });
}

export function loadOrders(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<Order[]> {
  return request<Order[]>('/api/orders', { signal });
}

export function loadFulfillmentOverview(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<FulfillmentOverview> {
  return request<FulfillmentOverview>('/api/admin/fulfillment/overview', {
    signal,
  });
}

export function loadAfterSales(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<AfterSaleCase[]> {
  return request<AfterSaleCase[]>('/api/admin/after-sales', { signal });
}
```

Move every existing action into its owning `api.ts` without changing paths or payloads:

- group buys: closure summary/refund orders, mark failed, close unpaid, final close, confirm refund, clone;
- orders: order AI context, status update, pickup verify, picking export URL;
- after-sales: review, resolve, add note, link loss.

API functions receive already-collected prompt values. Prompting and messages remain UI responsibilities.

- [ ] **Step 4: Run GREEN**

Run the command from Step 2.

Expected: all four API test files pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/sales apps/admin/src/features/fulfillment
git commit -m "refactor(admin): add sales fulfillment api boundaries"
```

---

### Task 2: Extract four isolated pages with local resource state

**Files:**
- Create: `apps/admin/src/features/sales/group-buys/GroupBuyManagementPage.tsx`
- Create: `apps/admin/src/features/sales/orders/OrdersPage.tsx`
- Create: `apps/admin/src/features/fulfillment/overview/FulfillmentOverviewPage.tsx`
- Create: `apps/admin/src/features/sales/after-sales/AfterSalesPage.tsx`
- Create: `apps/admin/src/features/sales/group-buys/page-model.ts`
- Create: `apps/admin/src/features/sales/group-buys/page-model.test.ts`

**Interfaces:**
- Each page consumes `refreshVersion`.
- `GroupBuyManagementPage` also consumes `activeView`, `onMessage`, and `onMutationCommitted`.
- `OrdersPage` consumes `onMessage` and `onMutationCommitted`.
- `AfterSalesPage` consumes `defaultLossProductId`, `onMessage`, and `onMutationCommitted`.
- `FulfillmentOverviewPage` is read-only.

- [ ] **Step 1: Write failing pure state tests for closure selection**

```ts
it('keeps closure selection while the primary list refreshes', () => {
  const state = {
    selectedGroupBuyId: 'g1',
    closureSummary: { group_buy_id: 'g1' },
    manualRefundOrders: [{ order_id: 'o1' }],
  } as ClosureWorkbenchState;

  expect(selectClosureGroupBuy(state, 'g2')).toEqual({
    selectedGroupBuyId: 'g2',
    closureSummary: null,
    manualRefundOrders: [],
  });
  expect(replaceClosureWorkbench(state, {
    summary: { group_buy_id: 'g1' },
    refundOrders: [{ order_id: 'o2' }],
  }).selectedGroupBuyId).toBe('g1');
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
../../node_modules/.bin/vitest run src/features/sales/group-buys/page-model.test.ts
```

Expected: fail because the page model does not exist.

- [ ] **Step 3: Implement the page model and move existing JSX**

Each page uses `initialFeatureResourceState`, `reduceFeatureResource`, `featureErrorMessage`, an `AbortController`, and a local retry counter. Required UI states:

- first load: page-specific `Spin`;
- refresh with data: keep existing data and show `正在刷新…`;
- error: page-specific `Alert` plus `重试`;
- retry: only that page's primary loader runs;
- previous data remains visible when a refresh fails.

Move JSX and handlers exactly:

- `GroupBuyManagementPage`: both `groupBuys` and `failedGroupBuyClosure` views, group list, closure selection/summary/refund table, and all existing copy;
- `OrdersPage`: order table, export links, order context, status/pickup actions;
- `FulfillmentOverviewPage`: current overview summary and two tables;
- `AfterSalesPage`: current table, prompts, review/resolve/note/loss actions.

After successful `cloneGroupBuy`, order status/pickup, or any after-sales mutation:

```ts
props.onMessage(existingMessage);
props.onMutationCommitted();
```

Closure actions instead reload only the selected workbench. Reading order context changes only page-local context and calls `onMessage` with the existing text.

- [ ] **Step 4: Run focused GREEN, typecheck, and build without repository output**

Run:

```bash
../../node_modules/.bin/vitest run src/features/sales src/features/fulfillment
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/l50-a3-2-admin-dist
```

from `apps/admin`.

Expected: focused tests pass; typecheck and Vite exit 0; the repository `dist/` is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/sales apps/admin/src/features/fulfillment
git commit -m "refactor(admin): extract sales fulfillment pages"
```

---

### Task 3: Integrate targeted refresh and remove sales state from AdminApp

**Files:**
- Modify: `apps/admin/src/app/refresh-policy.ts`
- Modify: `apps/admin/src/app/refresh-policy.test.ts`
- Modify: `apps/admin/src/app/AdminApp.tsx`

**Interfaces:**
- Produces refresh targets `group-buys`, `orders`, `fulfillment`, `after-sales`, `catalog`, `finance`, `operations`, and `legacy`.
- Produces a composition callback that invalidates every A3.2 slice plus remaining legacy data after cross-domain mutations.

- [ ] **Step 1: Extend the failing refresh/source contract**

Add exact mapping cases:

```ts
['groupBuys', 'group-buys'],
['failedGroupBuyClosure', 'group-buys'],
['orders', 'orders'],
['fulfillment', 'fulfillment'],
['afterSales', 'after-sales'],
```

Read `AdminApp.tsx` and require:

```ts
expect(source).not.toContain('"/api/group-buys"');
expect(source).not.toContain('"/api/orders"');
expect(source).not.toContain('"/api/admin/fulfillment/overview"');
expect(source).not.toContain('"/api/admin/after-sales"');
expect(source).not.toContain('type GroupBuy =');
expect(source).not.toContain('type Order =');
expect(source).not.toContain('type FulfillmentOverview =');
expect(source).not.toContain('type AfterSaleCase =');
expect(source).toContain('GroupBuyManagementPage');
expect(source).toContain('OrdersPage');
expect(source).toContain('FulfillmentOverviewPage');
expect(source).toContain('AfterSalesPage');
```

- [ ] **Step 2: Run RED**

Run:

```bash
../../node_modules/.bin/vitest run src/app/refresh-policy.test.ts
```

Expected: mapping and source-boundary assertions fail against the A3.1 base.

- [ ] **Step 3: Integrate the pages**

In `AdminApp`:

- add four refresh versions;
- add `refreshSalesAndLegacyFeatures()` that increments all four and calls `refreshLegacyFeatures()`;
- route Shell refresh to only the matching active version;
- remove the four primary endpoints from `refreshLegacyFeatures`;
- remove all sales/fulfillment/after-sales DTOs, state, handlers, and JSX;
- render the four pages under `hidden` wrappers;
- pass `setMessage`, `refreshSalesAndLegacyFeatures`, and `inventoryOverview?.items[0]?.product_id ?? ''` where required;
- retain authentication-time `refreshLegacyFeatures()` for remaining legacy pages;
- retain every remaining inventory/supply, withdrawal, alert, tax, login, and logout line unchanged except tuple removal caused by the four extracted endpoints.

- [ ] **Step 4: Run GREEN and Admin gates**

Run:

```bash
../../node_modules/.bin/vitest run
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/l50-a3-2-admin-dist
```

from `apps/admin`.

Expected: all Admin tests pass, typecheck/build exit 0, and `AdminApp` no longer contains sales primary endpoints or page implementations.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app apps/admin/src/features/sales apps/admin/src/features/fulfillment
git commit -m "refactor(admin): isolate sales fulfillment refresh"
```

---

### Task 4: Extend real-browser contracts for A3.2 isolation and recovery

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Extends existing real Session, catalog/finance/operations counters, 23-navigation smoke, render-error recovery, logout, and exact cleanup.

- [ ] **Step 1: Add failing source contracts**

Require counters for:

- `/api/group-buys`;
- `/api/orders`;
- `/api/admin/fulfillment/overview`;
- `/api/admin/after-sales`.

Require the smoke to:

- record initial baselines after authenticated hidden mounts, allowing React StrictMode duplicate attempts;
- navigate to `团购管理`, Shell-refresh, and prove only group-buy primary count increases by exactly one among A3.2 endpoints;
- navigate to `订单管理`, inject one `500` response for an active order refresh, and prove the order-local error plus retry appears while Shell remains available;
- navigate to the already-loaded `售后客服` during the order error, return, and prove the order error remains;
- retry, wait for a successful `/api/orders` response envelope, and prove the order table recovers;
- prove catalog/finance/operations request counts do not change during the A3.2 refresh/failure/retry sequence;
- retain 23/23 navigation, reload, forced render-error recovery, logout, and cleanup.

- [ ] **Step 2: Run contract RED**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: fail because A3.2 counters and recovery evidence are absent.

- [ ] **Step 3: Implement minimal Playwright evidence**

Use request-relative baselines. Do not assert a fixed absolute initial count. Failure injection must affect only the first active order refresh and must not mock successful login, Session Cookie, catalog, group-buy, fulfillment, after-sales, finance, operations, or legacy data.

- [ ] **Step 4: Run contract GREEN**

Run:

```bash
node --check scripts/admin-e2e/admin-smoke.mjs
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
```

Expected: JavaScript syntax passes and all E2E/cleanup contracts pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/admin-e2e/admin-smoke.mjs scripts/admin-e2e/contract.test.cjs
git commit -m "test(admin): cover sales fulfillment isolation"
```

---

### Task 5: Full gate, scope audit, review, PR, and stable checkpoint

**Files:**
- Modify only as needed for accurate task evidence: PR description and issue #84 comment.

**Interfaces:**
- Verifies the A3.2 no-behavior boundary and creates the A3.3 base.

- [ ] **Step 1: Audit the diff**

Run:

```bash
git diff --stat 7210df5421d27ad9b7cbfdcde064977839bc6262...HEAD
git diff --name-only 7210df5421d27ad9b7cbfdcde064977839bc6262...HEAD
git diff --check 7210df5421d27ad9b7cbfdcde064977839bc6262...HEAD
```

Expected final paths are this plan, the four feature slices, `AdminApp`, refresh policy/tests, and Admin E2E smoke/contracts. The reconstructed baseline `scripts/admin-e2e/fixture.ts` must match remote Blob `1d2a8f4385dda0560196598d2289182bb2edbbc2` and must not appear in the remote PR comparison.

- [ ] **Step 2: Run the complete local gate on final HEAD**

Run locally with existing dependencies:

```bash
../../node_modules/.bin/vitest run
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/l50-a3-2-admin-dist
node --check scripts/admin-e2e/admin-smoke.mjs
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
```

Run the final remote candidate on the self-hosted Runner after a fresh locked install:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node --import tsx --test scripts/admin-e2e/admin-auth-runtime.test.ts
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
pnpm e2e:admin
```

- [ ] **Step 3: Review requirements line by line**

Confirm:

- each of four slices owns its DTO/API/loading/error/retry/page state;
- the four primary endpoints and page DTOs are absent from `AdminApp`;
- active Shell refresh is slice-local;
- mutation freshness matches the pre-extraction behavior;
- closure-only actions remain closure-only;
- inventory-owned state remains in A3.3;
- no API, payload, copy, permission, persistence, schema, dependency, or destructive cleanup change is included;
- logs, tests, and PR text contain no credentials or PII.

- [ ] **Step 4: Open and review the implementation PR**

Create a Draft PR from `codex/l50-a3-2-sales-fulfillment-feature-slice` to `stable/l50-a3-1-business-base`, link #84 and this plan, and include exact local/Runner evidence. Mark Ready only after final HEAD is green and independent review has no unresolved Critical or Important finding.

- [ ] **Step 5: Merge and checkpoint**

Squash merge with a fixed expected remote head. Re-read PR head and merge commit after merge, then create `stable/l50-a3-2-business-base` at the verified merge commit. A3.3 inventory/supply starts only from that checkpoint.

## Plan Self-Review Result

- Spec coverage: advances the approved L50-A no-behavior refactor for the complete sales/fulfillment/after-sales checkpoint.
- Scope: four separately failing pages are one reviewable checkpoint because their mutations previously shared the same global refresh; inventory/supply remains A3.3.
- Placeholder scan: no TBD, TODO, undefined endpoint, or unresolved behavior choice remains.
- Type consistency: refresh target names, page props, DTO owners, loaders, and mutation callback names have one definition and matching consumers.
- Safety: no dependency, schema, migration, API, authorization, payment/refund, inventory, miniapp, POS, production data, report, or broad cleanup change is included.
