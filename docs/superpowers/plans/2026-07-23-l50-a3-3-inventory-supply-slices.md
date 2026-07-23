# L50-A3.3 Inventory and Supply Feature Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move inventory overview, purchase plans, suppliers, product batches, expiry alerts, and stock checks out of `AdminApp` into six isolated feature slices with typed APIs, local refresh/retry, preserved default references, and unchanged business behavior.

**Architecture:** `AdminApp` remains the authenticated composition root. It keeps all six supply slices mounted for the authenticated session and hides inactive slices so ledger selections, retry errors, and page-local state survive navigation. A compact reference bridge carries the first inventory product reference and first batch ID to purchase-plan, stock-check, and after-sales flows without restoring a shared supply `Promise.all`.

**Tech Stack:** React 18.3.1, Ant Design 5.23.0, TypeScript strict/noImplicitAny, Vite 6, Vitest 2, Node 20.19.0 or supported newer Node, pnpm 9.15.4, Playwright 1.61.1.

## Global Constraints

- Remote base is `stable/l50-a3-2-business-base` at merge commit `8728a78e2361fcbeb666d6d2070d96f88bcc4904`.
- Implementation branch is `codex/l50-a3-3-inventory-supply-feature-slice`.
- The reconstructed local A3.2 source is accepted because the A3.2 implementation Blob SHAs checked so far match the remote checkpoint exactly and the remote-only E2E fixture is restored from Blob `1d2a8f4385dda0560196598d2289182bb2edbbc2`.
- Do not change dependencies, `pnpm-lock.yaml`, Prisma schema, migrations, API routes, payloads, response envelopes, permissions, inventory accounting, purchase receiving, payment, refund, miniapp, POS, or persistent business behavior.
- Preserve all 23 L49 navigation labels and order, `App === AdminApp`, Session Cookie behavior, same-origin `/api`, money formatting, prompts, button copy, table columns, and action payloads.
- Keep all six A3.3 pages mounted for the authenticated session; use `hidden`, not conditional unmounting, for `inventory`, `purchasePlans`, `suppliers`, `batches`, `expiryAlerts`, and `stockChecks`.
- Each page owns its primary loader state, error, retry counter, and refresh version. Every primary loader uses `AbortController` plus a generation check before settling state.
- A slice failure must not disable Shell navigation or another feature. Each hidden A3.3 page has its own resettable `AdminErrorBoundary`.
- Shell refresh on an A3.3 view must request only that view's primary loader endpoint.
- A mutation that currently calls `refreshSalesAndLegacyFeatures()` must call one composition-root callback after success. The callback refreshes all six A3.3 slices, all four A3.2 sales/fulfillment slices, and the remaining legacy withdrawal/alert/tax data.
- Authentication restore and login must keep legacy preload behavior. A3.3 primary endpoints load from the six mounted pages rather than from `refreshLegacyFeatures()`.
- Preserve the purchase-plan default as the first inventory item, including product ID, stock unit, suggested quantity, and stock deduction fallback.
- Preserve the stock-check default as the first batch ID, falling back to the first inventory product ID.
- Preserve the after-sales loss default as the first inventory product ID.
- The compact reference bridge may store only the first product's fields required by these prompts and the first batch ID. It must not own lists, API loading, errors, or mutation behavior.
- Do not introduce process-local queues, singleton caches, sticky-session requirements, or new infrastructure in A3.3. Horizontal API/worker scaling, outbox/inbox, rate limits, capacity thresholds, and autoscaling remain L50-D/E and issues #85/#87.
- Do not submit `reports/`, generated `dist/`, `node_modules`, the reconstructed unchanged `scripts/admin-e2e/fixture.ts`, or a temporary workflow in the final PR.

---

### Task 1: Define typed inventory and supply API boundaries

**Files:**
- Create: `apps/admin/src/features/inventory/shared/types.ts`
- Create: `apps/admin/src/features/inventory/overview/api.ts`
- Create: `apps/admin/src/features/inventory/overview/api.test.ts`
- Create: `apps/admin/src/features/supply/purchase-plans/api.ts`
- Create: `apps/admin/src/features/supply/purchase-plans/api.test.ts`
- Create: `apps/admin/src/features/supply/suppliers/api.ts`
- Create: `apps/admin/src/features/supply/suppliers/api.test.ts`
- Create: `apps/admin/src/features/inventory/batches/api.ts`
- Create: `apps/admin/src/features/inventory/batches/api.test.ts`
- Create: `apps/admin/src/features/inventory/expiry-alerts/api.ts`
- Create: `apps/admin/src/features/inventory/expiry-alerts/api.test.ts`
- Create: `apps/admin/src/features/inventory/stock-checks/api.ts`
- Create: `apps/admin/src/features/inventory/stock-checks/api.test.ts`

**Interfaces:**
- Consumes: `JsonRequester` and `adminJsonRequest`.
- Produces: the exact current inventory/supply DTOs plus typed loaders and mutations. No API path or request body changes.

- [ ] **Step 1: Write failing loader and mutation contracts**

Create one test per boundary. Each primary loader must assert exact path and signal forwarding:

```ts
it('loads inventory overview with the caller signal', async () => {
  const signal = new AbortController().signal;
  const request = vi.fn(async <T>(): Promise<T> => ({
    low_stock_count: 0,
    out_of_stock_count: 0,
    total_sku_count: 0,
    items: [],
  }) as T) as JsonRequester;

  await loadInventoryOverview(request, signal);

  expect(request).toHaveBeenCalledWith('/api/admin/inventory/overview', {
    signal,
  });
});
```

The other primary loader assertions are:

```ts
expect(request).toHaveBeenCalledWith('/api/admin/purchase-plans', { signal });
expect(request).toHaveBeenCalledWith('/api/admin/suppliers', { signal });
expect(request).toHaveBeenCalledWith('/api/admin/inventory/batches', { signal });
expect(request).toHaveBeenCalledWith(
  '/api/admin/inventory/expiry-alerts?days=7',
  { signal },
);
expect(request).toHaveBeenCalledWith('/api/admin/stock-checks', { signal });
```

Mutation tests must preserve representative exact payloads:

```ts
expect(request).toHaveBeenCalledWith(
  '/api/admin/inventory/products/p1/adjust',
  {
    method: 'POST',
    body: JSON.stringify({ adjust_quantity: -2, reason: '盘亏' }),
  },
);

expect(request).toHaveBeenCalledWith('/api/admin/purchase-plans/plan-1/receive', {
  method: 'POST',
  body: JSON.stringify(receiveInput),
});

expect(request).toHaveBeenCalledWith('/api/admin/inventory/batches/b1/loss', {
  method: 'POST',
  body: JSON.stringify(lossInput),
});

expect(request).toHaveBeenCalledWith('/api/admin/stock-checks/c1/confirm', {
  method: 'POST',
});
```

- [ ] **Step 2: Run RED**

Run from `apps/admin`:

```bash
../../node_modules/.bin/vitest run \
  src/features/inventory/overview/api.test.ts \
  src/features/supply/purchase-plans/api.test.ts \
  src/features/supply/suppliers/api.test.ts \
  src/features/inventory/batches/api.test.ts \
  src/features/inventory/expiry-alerts/api.test.ts \
  src/features/inventory/stock-checks/api.test.ts
```

Expected: fail because the six API boundaries do not exist.

- [ ] **Step 3: Move exact DTOs and implement APIs**

`features/inventory/shared/types.ts` exports the existing `InventoryItem`, `InventoryOverview`, `StockLedger`, `PurchasePlanItem`, `PurchasePlan`, `Supplier`, `ProductBatch`, `BatchStockLedger`, `ExpiryAlert`, `StockCheckItem`, and `StockCheck`. It also exports:

```ts
export type InventoryProductReference = Pick<
  InventoryItem,
  | 'product_id'
  | 'product_name'
  | 'stock_unit'
  | 'suggest_purchase_quantity'
  | 'stock_deduct_quantity'
>;
```

Implement primary loaders with the established signature:

```ts
export function loadInventoryOverview(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<InventoryOverview> {
  return request<InventoryOverview>('/api/admin/inventory/overview', { signal });
}
```

Move every existing action without changing paths or payloads:

- inventory overview: product ledger and manual adjustment;
- purchase plans: create, confirm, cancel, and receive;
- suppliers: create and disable;
- batches: batch ledger and loss;
- expiry alerts: read seven-day alerts and unwrap `{ items }`;
- stock checks: create and confirm.

All prompt collection remains in pages or pure prompt models.

- [ ] **Step 4: Run GREEN**

Run the Step 2 command.

Expected: all six API test files pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/inventory apps/admin/src/features/supply
git commit -m "refactor(admin): add inventory supply api boundaries"
```

---

### Task 2: Add reusable latest-load state and prompt models

**Files:**
- Create: `apps/admin/src/shared/state/use-feature-resource-loader.ts`
- Modify: `apps/admin/src/shared/state/feature-resource.test.ts`
- Create: `apps/admin/src/features/supply/purchase-plans/prompt-model.ts`
- Create: `apps/admin/src/features/supply/purchase-plans/prompt-model.test.ts`
- Create: `apps/admin/src/features/inventory/stock-checks/prompt-model.ts`
- Create: `apps/admin/src/features/inventory/stock-checks/prompt-model.test.ts`

**Interfaces:**
- Produces `useFeatureResourceLoader<T>(loader, refreshVersion)` returning `{ state, retry }`.
- Produces pure prompt collectors that return exact existing payload inputs or `null` when the existing flow cancels.

- [ ] **Step 1: Write failing generation and prompt tests**

Extend the resource tests with a pure current-load predicate:

```ts
expect(isCurrentFeatureLoad({
  aborted: false,
  generation: 3,
  currentGeneration: 3,
})).toBe(true);
expect(isCurrentFeatureLoad({
  aborted: false,
  generation: 2,
  currentGeneration: 3,
})).toBe(false);
expect(isCurrentFeatureLoad({
  aborted: true,
  generation: 3,
  currentGeneration: 3,
})).toBe(false);
```

Prompt tests must prove:

```ts
it('builds the unchanged purchase-plan payload from the default product', () => {
  const answers = ['3', '箱', '24', '1200'];
  const prompt = vi.fn(() => answers.shift() ?? null);
  const input = collectPurchasePlanInput(productReference, prompt, () => 0);

  expect(input).toEqual({
    target_date: new Date(24 * 60 * 60 * 1000).toISOString(),
    supplier_name: '默认供应商',
    remark: '后台创建采购计划：采购数量与入库库存数量分开记录',
    items: [{
      product_id: 'p1',
      purchase_quantity: 3,
      purchase_unit: '箱',
      stock_in_quantity: 24,
      cost_price_cents: 1200,
      remark: '采购 3箱，入库 24斤',
    }],
  });
});
```

Stock-check tests cover first-batch selection and product fallback:

```ts
expect(
  collectStockCheckInput(
    { defaultBatchId: 'b1', defaultProductId: 'p1' },
    prompt,
  ),
).toEqual({
  remark: '后台创建盘点',
  items: [{
    batch_id: 'b1',
    product_id: undefined,
    actual_quantity: 8,
    reason: '后台盘点',
  }],
});
```

- [ ] **Step 2: Run RED**

```bash
../../node_modules/.bin/vitest run \
  src/shared/state/feature-resource.test.ts \
  src/features/supply/purchase-plans/prompt-model.test.ts \
  src/features/inventory/stock-checks/prompt-model.test.ts
```

Expected: fail because the generation guard and prompt models do not exist.

- [ ] **Step 3: Implement the minimal models and hook**

The guard is:

```ts
export function isCurrentFeatureLoad(input: {
  aborted: boolean;
  generation: number;
  currentGeneration: number;
}): boolean {
  return !input.aborted && input.generation === input.currentGeneration;
}
```

`useFeatureResourceLoader` must:

- use the existing `reduceFeatureResource`;
- increment a `generationRef` for every refresh/retry;
- create one `AbortController` per attempt;
- settle success/error only when `isCurrentFeatureLoad(...)` is true;
- abort the attempt in effect cleanup;
- preserve existing data during refresh failure;
- expose `retry()` as a local retry-counter increment.

The prompt models must reproduce the current prompt order, default values, `null`/empty cancellation semantics, payload keys, and messages exactly.

- [ ] **Step 4: Run GREEN**

Run the Step 2 command.

Expected: all resource and prompt-model tests pass.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/admin/src/shared/state \
  apps/admin/src/features/supply/purchase-plans \
  apps/admin/src/features/inventory/stock-checks
git commit -m "refactor(admin): add latest-load and supply prompt models"
```

---

### Task 3: Extract six independently mounted pages

**Files:**
- Create: `apps/admin/src/features/inventory/overview/InventoryOverviewPage.tsx`
- Create: `apps/admin/src/features/supply/purchase-plans/PurchasePlansPage.tsx`
- Create: `apps/admin/src/features/supply/suppliers/SuppliersPage.tsx`
- Create: `apps/admin/src/features/inventory/batches/InventoryBatchesPage.tsx`
- Create: `apps/admin/src/features/inventory/expiry-alerts/ExpiryAlertsPage.tsx`
- Create: `apps/admin/src/features/inventory/stock-checks/StockChecksPage.tsx`
- Create: `apps/admin/src/features/inventory/a3-3-pages-source-contract.test.ts`

**Interfaces:**
- Every page consumes `refreshVersion`.
- Mutating pages consume `onMessage` and `onMutationCommitted`.
- Inventory overview produces `onDefaultProductReference(reference | null)`.
- Batch inventory produces `onDefaultBatchId(id)`.
- Purchase plans consumes `defaultProductReference`.
- Stock checks consumes `defaultProductId` and `defaultBatchId`.

- [ ] **Step 1: Write the failing page source contract**

The contract reads all six pages and requires:

```ts
for (const page of pages) {
  expect(page).toContain('useFeatureResourceLoader');
  expect(page).toContain('refreshVersion');
  expect(page).toMatch(/message=".+加载失败"/);
  expect(page).toMatch(/>\s*重试\s*</);
}
```

It also requires the preserved secondary state and references:

```ts
expect(inventory).toContain('stockLedgers');
expect(inventory).toContain('onDefaultProductReference');
expect(purchasePlans).toContain('defaultProductReference');
expect(batches).toContain('batchLedgers');
expect(batches).toContain('onDefaultBatchId');
expect(stockChecks).toContain('defaultBatchId');
expect(stockChecks).toContain('defaultProductId');
expect(expiryAlerts).not.toContain('onMutationCommitted');
```

- [ ] **Step 2: Run RED**

```bash
../../node_modules/.bin/vitest run \
  src/features/inventory/a3-3-pages-source-contract.test.ts
```

Expected: fail because the six page files do not exist.

- [ ] **Step 3: Move the six JSX sections and handlers**

Each page uses `useFeatureResourceLoader` for its primary endpoint and renders:

- first load: page-specific `Spin`;
- refresh with data: existing data plus `正在刷新…`;
- error: page-specific `Alert` and local `重试`;
- refresh failure: previous data remains visible.

Preserve exact current UI and behavior:

- inventory overview: summary, inventory table, product ledger, adjustment, and per-product/default purchase-plan creation;
- purchase plans: list, default-product creation, confirm, cancel, and receive;
- suppliers: list, create prompts, and disable;
- batches: list, batch ledger, and loss prompts;
- expiry alerts: seven-day read-only table;
- stock checks: list, create prompts, and confirm.

Inventory and batch ledger loaders each use a keyed generation plus `AbortController` so a slower old selection cannot overwrite a newer selection. Abort those secondary requests on page unmount.

After each successful mutation:

```ts
props.onMessage(existingMessage);
props.onMutationCommitted();
```

After each successful primary load, publish only the compact default reference:

```ts
props.onDefaultProductReference(
  data.items[0]
    ? {
        product_id: data.items[0].product_id,
        product_name: data.items[0].product_name,
        stock_unit: data.items[0].stock_unit,
        suggest_purchase_quantity: data.items[0].suggest_purchase_quantity,
        stock_deduct_quantity: data.items[0].stock_deduct_quantity,
      }
    : null,
);
```

- [ ] **Step 4: Run focused GREEN, typecheck, and build outside the repository**

```bash
../../node_modules/.bin/vitest run src/features/inventory src/features/supply
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/l50-a3-3-admin-dist
```

Expected: focused tests pass; typecheck/build exit 0; repository `dist/` remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/inventory apps/admin/src/features/supply
git commit -m "refactor(admin): extract inventory supply pages"
```

---

### Task 4: Integrate precise refresh and remove supply ownership from AdminApp

**Files:**
- Modify: `apps/admin/src/app/refresh-policy.ts`
- Modify: `apps/admin/src/app/refresh-policy.test.ts`
- Modify: `apps/admin/src/app/AdminApp.tsx`

**Interfaces:**
- Adds refresh targets `inventory`, `purchase-plans`, `suppliers`, `batches`, `expiry-alerts`, and `stock-checks`.
- Produces `refreshBusinessFeatures()` that invalidates all ten extracted slices plus remaining legacy data.

- [ ] **Step 1: Extend the failing refresh/source contract**

Add exact mappings:

```ts
['inventory', 'inventory'],
['purchasePlans', 'purchase-plans'],
['suppliers', 'suppliers'],
['batches', 'batches'],
['expiryAlerts', 'expiry-alerts'],
['stockChecks', 'stock-checks'],
```

Require `AdminApp.tsx` to exclude all six primary endpoints and supply DTO/page implementations:

```ts
for (const endpoint of [
  '"/api/admin/inventory/overview"',
  '"/api/admin/purchase-plans"',
  '"/api/admin/suppliers"',
  '"/api/admin/inventory/batches"',
  '"/api/admin/inventory/expiry-alerts?days=7"',
  '"/api/admin/stock-checks"',
]) {
  expect(source).not.toContain(endpoint);
}
expect(source).not.toContain('type InventoryOverview =');
expect(source).not.toContain('type PurchasePlan =');
expect(source).not.toContain('type Supplier =');
expect(source).not.toContain('type ProductBatch =');
expect(source).not.toContain('type ExpiryAlert =');
expect(source).not.toContain('type StockCheck =');
```

- [ ] **Step 2: Run RED**

```bash
../../node_modules/.bin/vitest run src/app/refresh-policy.test.ts
```

Expected: mappings and source-boundary assertions fail against A3.2.

- [ ] **Step 3: Integrate the six pages and compact bridge**

In `AdminApp`:

- add six refresh versions;
- add `defaultInventoryProductReference` and `defaultBatchId`;
- remove the six primary endpoints from `refreshLegacyFeatures`, leaving withdrawals, alerts, and tax records in their existing tuple order;
- replace `refreshSalesAndLegacyFeatures()` with `refreshBusinessFeatures()` that increments all ten extracted refresh versions and calls `refreshLegacyFeatures()`;
- update every existing successful mutation callback to `refreshBusinessFeatures`;
- route Shell refresh to only the matching active A3.3 version;
- remove supply DTOs, list/ledger state, handlers, and JSX;
- render each new page under a persistent `hidden` wrapper and its own `AdminErrorBoundary`;
- pass compact reference callbacks/values to purchase plans, stock checks, and after-sales;
- keep authentication-time `refreshLegacyFeatures()` for remaining legacy views.

The composition root must not regain supply endpoint strings, prompt logic, mutation payloads, or list state.

- [ ] **Step 4: Run GREEN and Admin gates**

```bash
../../node_modules/.bin/vitest run
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/l50-a3-3-admin-dist
```

Expected: all Admin tests pass, typecheck/build exit 0, and `AdminApp` no longer contains supply primary endpoints or page implementations.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app apps/admin/src/features/inventory apps/admin/src/features/supply
git commit -m "refactor(admin): isolate inventory supply refresh"
```

---

### Task 5: Extend browser evidence for A3.3 isolation and recovery

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Extends the existing A3.2, catalog, finance, operations, Session, 23-navigation, render-error, logout, and exact-cleanup contracts.

- [ ] **Step 1: Add failing A3.3 source contracts**

Require counters for the six primary endpoints and prove:

- authenticated hidden mount settles all six page loaders before taking baselines;
- Shell refresh on `库存管理` increases only inventory overview by exactly one;
- a one-shot `500` on `/api/admin/purchase-plans` produces only the purchase-plan local error while Shell remains usable;
- navigating to already-loaded `批次库存` and back preserves the purchase-plan error without new A3.3 requests;
- local retry waits for a real successful purchase-plan envelope, removes the error, and renders the table;
- catalog, A3.2 sales/fulfillment, finance, operations, and the other five A3.3 counters stay unchanged during each local refresh/failure/retry assertion;
- no successful API response is mocked;
- 23/23 navigation, forced render-error recovery, reload, logout, and cleanup remain intact.

- [ ] **Step 2: Run contract RED**

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: fail because A3.3 counters, failure, persistence, retry, and exact-isolation evidence are absent.

- [ ] **Step 3: Implement minimal Playwright evidence**

Use operation-relative baselines rather than fixed StrictMode counts. Add only one literal purchase-plan route interception inside its one-shot failure setup, remove it before retry, and await a real `response.ok()` purchase-plan response plus `{ success: true, data: [...] }`.

Extend the route-registration whitelist and mutation tests so broad globs, RegExp interceptors, predeclared success handlers, relocated failure handlers, missing `unroute`, missing cross-page error persistence, or missing exact counter assertions all make the contract fail.

- [ ] **Step 4: Run contract GREEN**

```bash
node --check scripts/admin-e2e/admin-smoke.mjs
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
```

Expected: syntax passes and every E2E/cleanup contract passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/admin-e2e/admin-smoke.mjs scripts/admin-e2e/contract.test.cjs
git commit -m "test(admin): cover inventory supply isolation"
```

---

### Task 6: Full gate, scope audit, review, PR, and stable checkpoint

**Files:**
- Modify only as needed for accurate task evidence: PR description and issue #84 comment.

**Interfaces:**
- Verifies the A3.3 no-behavior boundary and creates the A3.4 base.

- [ ] **Step 1: Audit the final diff**

```bash
git diff --stat fa5eef4b25dfeb6d2a4a7a6f51c0fa3aeaf0e8d0...HEAD
git diff --name-only fa5eef4b25dfeb6d2a4a7a6f51c0fa3aeaf0e8d0...HEAD
git diff --check fa5eef4b25dfeb6d2a4a7a6f51c0fa3aeaf0e8d0...HEAD
```

Expected final paths are this plan, six feature slices, the shared loader helper/tests, `AdminApp`, refresh policy/tests, and Admin E2E smoke/contracts. `scripts/admin-e2e/fixture.ts` must hash to remote Blob `1d2a8f4385dda0560196598d2289182bb2edbbc2` and must not appear in the remote PR comparison.

- [ ] **Step 2: Run the complete local gate on final HEAD**

```bash
../../node_modules/.bin/vitest run
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
node_modules/.bin/vite build --outDir /tmp/l50-a3-3-admin-dist
node --check scripts/admin-e2e/admin-smoke.mjs
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
git diff --check
```

Run the final remote candidate on the self-hosted Runner after a fresh pnpm 9.15.4 locked install:

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

- every A3.3 page owns its DTO/API/loading/error/retry/page state;
- six primary endpoints and supply DTOs are absent from `AdminApp`;
- active Shell refresh is slice-local;
- all ten extracted slices plus legacy data refresh after cross-domain mutations;
- default purchase-product, stock-check batch/product, and after-sales loss product behavior is unchanged;
- ledger selection is protected from out-of-order responses;
- no process-local scaling dependency, API/payload/copy/permission/persistence/schema/dependency change, or destructive cleanup is included;
- logs, tests, and PR text contain no credentials or PII.

- [ ] **Step 4: Open and review the implementation PR**

Create a Draft PR from `codex/l50-a3-3-inventory-supply-feature-slice` to `stable/l50-a3-2-business-base`, link #84 and this plan, and include exact local/Runner evidence. Mark Ready only after final HEAD is green and review has no unresolved Critical or Important finding.

- [ ] **Step 5: Merge and checkpoint**

Squash merge with a fixed expected remote head. Re-read PR head and merge commit after merge, then create `stable/l50-a3-3-business-base` at the verified merge commit. A3.4 may start only from that checkpoint.

## Plan Self-Review Result

- Spec coverage: all six approved A3.3 slices, compact references, local retry, generation safety, error isolation, mutation freshness, real browser recovery, and checkpoint creation are assigned to explicit tasks.
- Scope: the six slices form one checkpoint because their defaults and mutations currently share the same supply `Promise.all`; L50-D/E scaling infrastructure remains separately testable work.
- Placeholder scan: no TBD, TODO, undefined endpoint, or unresolved behavior choice remains.
- Type consistency: refresh target names, page props, shared DTOs, compact references, loader signatures, and mutation callback names have one definition and matching consumers.
- Safety: no dependency, schema, migration, API, authorization, inventory accounting, payment/refund, miniapp, POS, production data, report, generated output, or broad cleanup change is included.
