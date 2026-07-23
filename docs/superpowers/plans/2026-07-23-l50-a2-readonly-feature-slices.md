# L50-A2 Read-Only Feature Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the finance reconciliation and operations dashboard slices out of `AdminApp`, give each slice its own typed API loader and request state, and make the Shell refresh only the active extracted slice while preserving every endpoint, label, table, export, session, and business behavior.

**Architecture:** `AdminApp` remains the authenticated composition root and keeps all legacy mutable features during A2. The finance and operations slices move to `features/*`, load lazily through the A1 typed JSON requester, own their loading/error/data state, and accept a numeric refresh version from the composition root. The legacy refresh remains for non-extracted features until A3, but no longer requests finance or operations data.

**Tech Stack:** React 18.3.1, Ant Design 5.23.0, TypeScript strict/noImplicitAny, Vite 6, Vitest 2, Node 20.19.0, pnpm 9.15.4, Playwright 1.61.1.

## Global Constraints

- Base branch is `stable/l50-business-base` at merge commit `721ad385eca0432c1f9db6aad92e31355e2bd35c`.
- Do not change dependencies, `pnpm-lock.yaml`, Prisma schema, migrations, API routes, payloads, response envelopes, permissions, payment, refund, inventory, miniapp, or POS behavior.
- Preserve the 23 L49 navigation labels and their order.
- Preserve `App === AdminApp`, same-origin `/api` behavior, `credentials: include`, and existing Session Cookie behavior.
- Permission metadata remains descriptive only; server-side authorization remains authoritative.
- Finance and operations exports remain browser navigations to the existing CSV endpoints.
- A failure in finance must not prevent operations or any legacy view from loading.
- A2 does not remove the legacy refresh for mutable features; complete removal is assigned to L50-A3.

---

### Task 1: Establish the configured Admin API and feature resource state

**Files:**
- Create: `apps/admin/src/shared/api/admin-api.ts`
- Create: `apps/admin/src/shared/state/feature-resource.ts`
- Create: `apps/admin/src/shared/state/feature-resource.test.ts`

**Interfaces:**
- Consumes: `createJsonRequester`, `JsonRequester`, and `AdminApiError`.
- Produces: `adminJsonRequest`, `adminApiUrl`, `FeatureResourceState<T>`, `FeatureResourceAction<T>`, `initialFeatureResourceState<T>()`, `reduceFeatureResource<T>()`, and `featureErrorMessage(error)`.

- [ ] **Step 1: Write the failing feature resource tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from './feature-resource';

describe('feature resource state', () => {
  it('keeps prior data visible while a refresh starts', () => {
    const ready = reduceFeatureResource(
      initialFeatureResourceState<number>(),
      { type: 'resolved', data: 7 },
    );
    expect(reduceFeatureResource(ready, { type: 'started' })).toEqual({
      status: 'refreshing',
      data: 7,
      error: null,
    });
  });

  it('records a safe error without discarding prior data', () => {
    expect(
      reduceFeatureResource(
        { status: 'ready', data: 7, error: null },
        { type: 'rejected', message: '加载失败' },
      ),
    ).toEqual({
      status: 'error',
      data: 7,
      error: '加载失败',
    });
  });

  it('does not expose arbitrary object fields as an error message', () => {
    expect(featureErrorMessage({ token: 'secret' })).toBe('页面数据加载失败');
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/shared/state/feature-resource.test.ts
```

Expected: FAIL because `feature-resource.ts` does not exist.

- [ ] **Step 3: Implement the pure state reducer and safe error mapping**

```ts
import { AdminApiError } from '../api/errors';

export type FeatureResourceState<T> = {
  status: 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
  data: T | null;
  error: string | null;
};

export type FeatureResourceAction<T> =
  | { type: 'started' }
  | { type: 'resolved'; data: T }
  | { type: 'rejected'; message: string };

export function initialFeatureResourceState<T>(): FeatureResourceState<T> {
  return { status: 'idle', data: null, error: null };
}

export function reduceFeatureResource<T>(
  state: FeatureResourceState<T>,
  action: FeatureResourceAction<T>,
): FeatureResourceState<T> {
  if (action.type === 'started') {
    return {
      status: state.data === null ? 'loading' : 'refreshing',
      data: state.data,
      error: null,
    };
  }
  if (action.type === 'resolved') {
    return { status: 'ready', data: action.data, error: null };
  }
  return { status: 'error', data: state.data, error: action.message };
}

export function featureErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError || error instanceof Error) {
    return error.message;
  }
  return '页面数据加载失败';
}
```

- [ ] **Step 4: Configure one shared requester and URL builder**

```ts
import { createJsonRequester } from './client';

const adminApiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? '';

export const adminJsonRequest = createJsonRequester({
  baseUrl: adminApiBaseUrl,
});

export function adminApiUrl(path: string): string {
  return `${adminApiBaseUrl}${path}`;
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/shared/state/feature-resource.test.ts
pnpm --filter @community-selection/admin typecheck
```

Expected: 3 tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/shared/api/admin-api.ts apps/admin/src/shared/state/feature-resource.ts apps/admin/src/shared/state/feature-resource.test.ts
git commit -m "refactor(admin): add feature resource state"
```

---

### Task 2: Extract the finance reconciliation slice

**Files:**
- Create: `apps/admin/src/features/finance/reconciliation/types.ts`
- Create: `apps/admin/src/features/finance/reconciliation/api.ts`
- Create: `apps/admin/src/features/finance/reconciliation/api.test.ts`
- Create: `apps/admin/src/features/finance/reconciliation/FinanceReconciliationPage.tsx`

**Interfaces:**
- Consumes: `JsonRequester`, `adminJsonRequest`, `adminApiUrl`, `reduceFeatureResource`, and `featureErrorMessage`.
- Produces: `FinanceReconciliationData`, `loadFinanceReconciliation(request, signal?)`, and `FinanceReconciliationPage({ refreshVersion })`.

- [ ] **Step 1: Write the failing loader contract test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { loadFinanceReconciliation } from './api';

describe('finance reconciliation loader', () => {
  it('loads the four existing endpoints and maps list envelopes', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/overview')) return { paid_amount: 100 };
      if (path.endsWith('/orders')) return { items: [{ order_id: 'o1' }] };
      if (path.endsWith('/rewards')) return [{ reward_id: 'r1' }];
      return [{ after_sale_case_id: 'a1' }];
    });

    const data = await loadFinanceReconciliation(request);

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/finance/reconciliation/overview',
      '/api/admin/finance/reconciliation/orders',
      '/api/admin/finance/reconciliation/rewards',
      '/api/admin/finance/reconciliation/after-sales',
    ]);
    expect(data.orders).toEqual([{ order_id: 'o1' }]);
    expect(data.rewards).toEqual([{ reward_id: 'r1' }]);
    expect(data.afterSales).toEqual([{ after_sale_case_id: 'a1' }]);
  });
});
```

- [ ] **Step 2: Run the loader test and verify RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/finance/reconciliation/api.test.ts
```

Expected: FAIL because `api.ts` does not exist.

- [ ] **Step 3: Move the exact finance DTOs and implement the loader**

`types.ts` must contain the current `FinanceOverview`, `FinanceOrderRow`, `FinanceRewardRow`, and `FinanceAfterSaleRow` fields without renaming or changing units, plus:

```ts
export type FinanceReconciliationData = {
  overview: FinanceOverview;
  orders: FinanceOrderRow[];
  rewards: FinanceRewardRow[];
  afterSales: FinanceAfterSaleRow[];
};
```

`api.ts`:

```ts
import type { JsonRequester } from '../../../shared/api/client';
import { adminJsonRequest } from '../../../shared/api/admin-api';
import type {
  FinanceAfterSaleRow,
  FinanceOrderRow,
  FinanceOverview,
  FinanceReconciliationData,
  FinanceRewardRow,
} from './types';

export async function loadFinanceReconciliation(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<FinanceReconciliationData> {
  const [overview, orders, rewards, afterSales] = await Promise.all([
    request<FinanceOverview>('/api/admin/finance/reconciliation/overview', { signal }),
    request<{ items: FinanceOrderRow[] }>('/api/admin/finance/reconciliation/orders', { signal }),
    request<FinanceRewardRow[]>('/api/admin/finance/reconciliation/rewards', { signal }),
    request<FinanceAfterSaleRow[]>('/api/admin/finance/reconciliation/after-sales', { signal }),
  ]);
  return {
    overview,
    orders: orders.items,
    rewards,
    afterSales,
  };
}
```

- [ ] **Step 4: Run the loader test and verify GREEN**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/finance/reconciliation/api.test.ts
```

Expected: the loader contract passes.

- [ ] **Step 5: Move the current finance JSX into a page with local request state**

`FinanceReconciliationPage.tsx` must:

- accept `refreshVersion: number`;
- start `loadFinanceReconciliation` on mount and whenever `refreshVersion` changes;
- abort the previous request group on unmount or refresh;
- show `Spin` while no data exists;
- show an `Alert` with the safe error and a local “重试” button on failure;
- keep prior data visible while refreshing;
- preserve all current card labels, table columns, formatting, row keys, and three CSV URLs;
- use `adminApiUrl()` for CSV URLs;
- never write to Shell `message`.

- [ ] **Step 6: Run finance tests, typecheck and build**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/finance/reconciliation/api.test.ts src/shared/state/feature-resource.test.ts
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
```

Expected: all focused tests pass; typecheck and build exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/finance/reconciliation
git commit -m "refactor(admin): extract finance reconciliation"
```

---

### Task 3: Extract the operations dashboard slice

**Files:**
- Create: `apps/admin/src/features/operations/dashboard/types.ts`
- Create: `apps/admin/src/features/operations/dashboard/api.ts`
- Create: `apps/admin/src/features/operations/dashboard/api.test.ts`
- Create: `apps/admin/src/features/operations/dashboard/OperationsDashboardPage.tsx`

**Interfaces:**
- Consumes: the same requester, resource state, and URL interfaces as Task 2.
- Produces: `OperationsDashboardData`, `loadOperationsDashboard(request, signal?)`, and `OperationsDashboardPage({ refreshVersion })`.

- [ ] **Step 1: Write the failing loader contract test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { loadOperationsDashboard } from './api';

describe('operations dashboard loader', () => {
  it('loads the six existing dashboard endpoints in one feature boundary', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/overview')) return { order_count: 1 };
      return [];
    });

    const data = await loadOperationsDashboard(request);

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/admin/operations/dashboard/overview',
      '/api/admin/operations/dashboard/trends?days=7',
      '/api/admin/operations/dashboard/products',
      '/api/admin/operations/dashboard/communities',
      '/api/admin/operations/dashboard/pickup-stores',
      '/api/admin/operations/dashboard/alerts',
    ]);
    expect(data.overview).toEqual({ order_count: 1 });
  });
});
```

- [ ] **Step 2: Run the loader test and verify RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/operations/dashboard/api.test.ts
```

Expected: FAIL because `api.ts` does not exist.

- [ ] **Step 3: Move the exact operations DTOs and implement the loader**

`types.ts` must preserve the current `OperationsOverview`, `OperationsTrendRow`, `OperationsProductRow`, `OperationsCommunityRow`, `OperationsPickupStoreRow`, and `OperationsAlertRow` fields, and define:

```ts
export type OperationsDashboardData = {
  overview: OperationsOverview;
  trends: OperationsTrendRow[];
  products: OperationsProductRow[];
  communities: OperationsCommunityRow[];
  pickupStores: OperationsPickupStoreRow[];
  alerts: OperationsAlertRow[];
};
```

`api.ts` uses `Promise.all` only inside this feature and passes the same `AbortSignal` to all six calls.

- [ ] **Step 4: Run the loader test and verify GREEN**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/operations/dashboard/api.test.ts
```

Expected: the loader contract passes.

- [ ] **Step 5: Move the current operations JSX into a page with local request state**

`OperationsDashboardPage.tsx` follows the finance page lifecycle and preserves the current eight summary cards, five CSV links, five tables, labels, formats, row keys, and endpoint paths exactly.

- [ ] **Step 6: Run operations tests, typecheck and build**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/operations/dashboard/api.test.ts src/shared/state/feature-resource.test.ts
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
```

Expected: all focused tests pass; typecheck and build exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/operations/dashboard
git commit -m "refactor(admin): extract operations dashboard"
```

---

### Task 4: Route refresh to the active feature and remove extracted global state

**Files:**
- Create: `apps/admin/src/app/refresh-policy.ts`
- Create: `apps/admin/src/app/refresh-policy.test.ts`
- Modify: `apps/admin/src/app/AdminApp.tsx`

**Interfaces:**
- Consumes: `AdminViewKey`, `FinanceReconciliationPage`, and `OperationsDashboardPage`.
- Produces: `adminRefreshTarget(view): 'finance' | 'operations' | 'legacy'` and the integrated active-feature refresh behavior.

- [ ] **Step 1: Write the failing refresh policy test**

```ts
import { describe, expect, it } from 'vitest';
import { adminRefreshTarget } from './refresh-policy';

describe('admin refresh policy', () => {
  it.each([
    ['finance', 'finance'],
    ['operations', 'operations'],
    ['products', 'legacy'],
    ['inventory', 'legacy'],
  ] as const)('routes %s refresh to %s', (view, target) => {
    expect(adminRefreshTarget(view)).toBe(target);
  });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/app/refresh-policy.test.ts
```

Expected: FAIL because `refresh-policy.ts` does not exist.

- [ ] **Step 3: Implement the pure policy**

```ts
import type { AdminViewKey } from './admin-view';

export type AdminRefreshTarget = 'finance' | 'operations' | 'legacy';

export function adminRefreshTarget(view: AdminViewKey): AdminRefreshTarget {
  if (view === 'finance' || view === 'operations') return view;
  return 'legacy';
}
```

- [ ] **Step 4: Integrate without changing legacy mutations**

In `AdminApp.tsx`:

1. import the two extracted pages and `adminRefreshTarget`;
2. add `financeRefreshVersion` and `operationsRefreshVersion` state counters;
3. rename `refresh()` to `refreshLegacyFeatures()`;
4. delete the four finance and six operations calls from its `Promise.all`;
5. delete the matching tuple positions, setters, state variables, DTO types, and inline JSX;
6. leave every remaining legacy request, setter, mutation handler, and post-mutation refresh unchanged;
7. implement:

```ts
function refreshActiveFeature() {
  const target = adminRefreshTarget(view);
  if (target === 'finance') {
    setFinanceRefreshVersion((version) => version + 1);
    return;
  }
  if (target === 'operations') {
    setOperationsRefreshVersion((version) => version + 1);
    return;
  }
  refreshLegacyFeatures();
}
```

8. render:

```tsx
{view === 'finance' ? (
  <FinanceReconciliationPage refreshVersion={financeRefreshVersion} />
) : null}
{view === 'operations' ? (
  <OperationsDashboardPage refreshVersion={operationsRefreshVersion} />
) : null}
```

9. pass `refreshActiveFeature` to `AdminShell`;
10. keep login/session initialization calling `refreshLegacyFeatures()` because the default view remains `products`;
11. keep all legacy mutation handlers calling `refreshLegacyFeatures()`.

- [ ] **Step 5: Add a source contract that prevents the ten extracted endpoints returning to `AdminApp`**

Extend `refresh-policy.test.ts` to read `AdminApp.tsx` and assert that none of these prefixes occur:

```ts
[
  '/api/admin/finance/reconciliation/',
  '/api/admin/operations/dashboard/',
]
```

The test must also assert that `FinanceReconciliationPage` and `OperationsDashboardPage` are imported and rendered.

- [ ] **Step 6: Run all Admin gates**

Run:

```bash
pnpm --filter @community-selection/admin test
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
```

Expected: all Admin tests pass and both static gates exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/app/AdminApp.tsx apps/admin/src/app/refresh-policy.ts apps/admin/src/app/refresh-policy.test.ts
git commit -m "refactor(admin): isolate read-only feature refresh"
```

---

### Task 5: Extend real browser coverage for lazy feature loading and retry

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Consumes: the existing one-time administrator, real Session login, Playwright browser, and cleanup runner.
- Produces: browser evidence for lazy finance/operations requests, active refresh, feature-local failure, retry, and cross-feature isolation.

- [ ] **Step 1: Add failing source/behavior contracts**

The contract must require the smoke script to:

- count finance and operations dashboard requests separately;
- prove neither group is requested before its view is selected;
- select finance and prove its four requests complete;
- click Shell refresh while finance is active and prove finance requests repeat without operations requests;
- intercept one operations overview request with a `500` envelope;
- prove the operations page shows local error UI while Shell navigation remains available;
- click “重试”, allow the real response, and prove the operations dashboard renders;
- continue to logout and cleanup.

- [ ] **Step 2: Run the contracts and verify RED**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: FAIL because the smoke script does not yet contain lazy-loading and retry assertions.

- [ ] **Step 3: Implement the Playwright assertions**

Use `page.on('request')` counters and `page.route()` for only the first operations overview request. Do not mock login, Session Cookie, finance success data, operations retry success data, or any legacy page.

- [ ] **Step 4: Run contracts and real Admin E2E**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
pnpm setup:admin:e2e
pnpm e2e:admin
```

Expected: contracts pass; browser smoke confirms all previous 23 navigation items plus the new lazy-load/refresh/error/retry assertions; cleanup removes browser, API/Admin children, administrator, PostgreSQL volume, and network.

- [ ] **Step 5: Commit**

```bash
git add scripts/admin-e2e/admin-smoke.mjs scripts/admin-e2e/contract.test.cjs
git commit -m "test(admin): cover feature-local refresh and retry"
```

---

### Task 6: Full gate, scope audit, and pull request

**Files:**
- Modify only when required for accurate task evidence: PR description and issue #84 comment.

**Interfaces:**
- Verifies every A2 interface and produces merge evidence.

- [ ] **Step 1: Audit the diff**

Run:

```bash
git status -sb
git diff --stat stable/l50-business-base...HEAD
git diff --name-only stable/l50-business-base...HEAD
```

Expected: only the A2 plan, Admin feature/shared/app files, and Admin E2E files appear. No dependency, lockfile, Prisma, migration, API route, miniapp, payment, refund, inventory service, POS, report, or unrelated docs file appears.

- [ ] **Step 2: Run the complete repository gate**

Run:

```bash
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node --import tsx --test scripts/admin-e2e/admin-auth-runtime.test.ts
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
pnpm e2e:admin
```

Expected: every command exits 0, the Admin E2E cleans all resources, and no warning indicates a skipped verification.

- [ ] **Step 3: Review the requirements line by line**

Confirm:

- finance and operations own their DTOs, loaders, state, error, retry, and rendering;
- the ten extracted endpoints do not occur in `AdminApp`;
- Shell refresh targets only the active extracted feature;
- legacy views and post-mutation refresh behavior remain unchanged;
- one extracted feature failure cannot disable Shell or the other feature;
- no permission metadata is treated as authorization;
- no PII or credentials appear in errors, logs, fixtures, plan, or PR;
- no resource remains after success, failure, `SIGINT`, or `SIGTERM`.

- [ ] **Step 4: Open the implementation PR**

Push `codex/l50-a2-readonly-feature-slices` and open a draft PR targeting `stable/l50-business-base`. Link #84 and this plan, include exact Runner run IDs and commands, state the ten removed global requests, and state that L50-A3 starts only after merge and a new stable checkpoint.

## Plan Self-Review Result

- Spec coverage: A2 implements real per-feature DTO/API/state/error boundaries and moves two existing domains without endpoint or business changes.
- Scope: finance and operations form one bounded read-only migration pattern; mutable catalog, sales, fulfillment, and inventory remain for A3.
- Placeholder scan: the plan contains no unresolved implementation markers or unspecified acceptance step.
- Type consistency: `JsonRequester`, `FinanceReconciliationData`, `OperationsDashboardData`, `FeatureResourceState<T>`, `refreshVersion`, and `adminRefreshTarget` have one definition and matching consumers.
- Safety: no production data mutation, dependency change, schema change, authorization change, POS write, or destructive cleanup is introduced.
