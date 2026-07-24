# L50-B2 Role Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `今日经营` module the authenticated role workbench, with role-specific shortcuts into existing Admin pages and the existing operations dashboard as its live business data.

**Architecture:** A pure role-workbench model normalizes the current `AdminUser.role` string into a presentation profile and a fixed list of existing `AdminViewKey` shortcuts. A small presentational component renders that model above the already-isolated `OperationsDashboardPage`; `AdminApp` remains the only navigation owner. This metadata is recommendation-only and never filters navigation or authorizes an action.

**Tech Stack:** React 18.3.1, TypeScript strict, Ant Design 5.23.0, Vitest 2.1.8, Vite 6.0.7, Playwright Admin E2E.

## Global Constraints

- Base the remote implementation on `stable/l50-a3-4-business-base` at the merged L50-B1 checkpoint.
- Preserve all 23 existing navigation items, exact labels, page reachability, refresh behavior, session restore, logout, local loading/error/retry state, and mutation invalidation.
- Use only existing Admin pages and existing operations-dashboard endpoints.
- Role-workbench metadata is not authorization. Do not hide navigation, block actions, or trust the client role for permission decisions.
- Unknown role strings must receive a safe generic workbench instead of an empty or broken page.
- Do not change API routes, request payloads, Prisma, migrations, dependencies, lockfiles, miniapp, payment, refund, inventory accounting, or persistent business behavior.
- Do not add RBAC tables, data scope, organization/store/channel/device models, all-channel order fields, POS, electronic-scale, AI-recognition, connector, sync, pressure-test, or intelligent-operations capabilities.
- Keep Runner limits at workspace concurrency 1, Vitest at no more than 2 workers, and Node heap at no more than 3 GiB when the temporary full gate is created.

## Design Decision

Three approaches were considered:

1. **Enrich the existing `operations` page and make it the authenticated landing view — selected.** It reuses the existing six-endpoint resource lifecycle and keeps the role-workbench change inside one bounded Admin slice.
2. Add a second homepage view and duplicate or share the operations resource. Rejected because it adds a 24th navigation/view contract and risks duplicate requests and divergent refresh state.
3. Build server-driven RBAC, data scope, and role-specific API aggregates now. Rejected because that belongs to later authorization and domain-contract stages and would require schema/API work outside B2.

---

### Task 1: Define the Pure Role-Workbench Contract

**Files:**
- Create: `apps/admin/src/app/role-workbench.ts`
- Create: `apps/admin/src/app/role-workbench.test.ts`

**Interfaces:**
- Consumes: `AdminViewKey`
- Produces: `RoleWorkbenchProfile`, `RoleWorkbenchAction`, `createRoleWorkbenchModel(role)`

- [ ] **Step 1: Write failing model tests**

Create tests that require:

```ts
expect(createRoleWorkbenchModel('admin')).toMatchObject({
  key: 'owner',
  label: '经营负责人',
  actions: [
    { target: 'orders', label: '订单管理' },
    { target: 'inventory', label: '库存管理' },
    { target: 'finance', label: '财务对账' },
    { target: 'alerts', label: '告警中心' },
  ],
});
```

Also require:

- `super_admin`, `owner`, `organization_admin`, and `admin` use the owner profile;
- `store_manager`, `inventory_operator`, `customer_service`, `finance_operator`, `finance_auditor`, `system_admin`, and `risk_operator` receive the exact bounded profile assigned below;
- role matching trims whitespace and ignores ASCII case;
- an unknown or blank role receives the `general` profile;
- every action target is a non-login `ADMIN_VIEW_KEYS` value;
- every action label exactly matches the corresponding `ADMIN_FEATURES` label.

Profile assignments:

```ts
owner: orders, inventory, finance, alerts
store: orders, fulfillment, inventory, expiryAlerts, alerts
inventory: inventory, purchasePlans, batches, expiryAlerts, stockChecks
customer-service: orders, afterSales, pickupWorkbench, deliveryReservation
finance: finance, refundLedger, withdrawals, taxRecords
system: alerts, dashboardV2, operations
general: orders, products, inventory, alerts
```

- [ ] **Step 2: Verify RED**

Run:

```bash
./node_modules/.bin/vitest run apps/admin/src/app/role-workbench.test.ts
```

Expected: FAIL because `role-workbench.ts` does not exist.

- [ ] **Step 3: Implement the minimum pure model**

Define:

```ts
export type RoleWorkbenchKey =
  | 'owner'
  | 'store'
  | 'inventory'
  | 'customer-service'
  | 'finance'
  | 'system'
  | 'general';

export type RoleWorkbenchAction = {
  target: Exclude<AdminViewKey, 'login'>;
  label: string;
};

export type RoleWorkbenchProfile = {
  key: RoleWorkbenchKey;
  label: string;
  description: string;
  actions: readonly RoleWorkbenchAction[];
};

export function createRoleWorkbenchModel(role: string): RoleWorkbenchProfile;
```

Build labels from `ADMIN_FEATURES`, not from a second handwritten page-label table. Normalize only known aliases; do not infer authorization or remove any navigation item.

- [ ] **Step 4: Verify GREEN**

Run the focused test again. Expected: all role, fallback, target, and label assertions pass.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app/role-workbench.ts \
  apps/admin/src/app/role-workbench.test.ts
git commit -m "feat(admin): model L50 role workbenches"
```

---

### Task 2: Render the Workbench and Make It the Authenticated Landing View

**Files:**
- Create: `apps/admin/src/app/RoleWorkbench.tsx`
- Create: `apps/admin/src/app/RoleWorkbench.test.tsx`
- Modify: `apps/admin/src/app/AdminApp.tsx`
- Modify: `apps/admin/src/app/admin-view.ts`
- Modify: `apps/admin/src/app/admin-view.test.ts`

**Interfaces:**
- Consumes: `createRoleWorkbenchModel(role)`, `AdminViewKey`, `OperationsDashboardPage`
- Produces: `RoleWorkbench({ role, onNavigate })`
- Preserves: operations-dashboard loading/error/retry/refresh lifecycle

- [ ] **Step 1: Write failing landing and rendering tests**

Change the Admin view contract to require:

```ts
expect(DEFAULT_ADMIN_VIEW).toBe('operations');
```

Create a server-render test with `renderToStaticMarkup` that requires an `admin` role to render:

- `今日经营工作台`;
- `当前工作台：经营负责人`;
- the four owner shortcut labels;
- a note that shortcuts do not replace server authorization.

Require an unknown role to render `当前工作台：综合运营`.

- [ ] **Step 2: Verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/app/admin-view.test.ts \
  apps/admin/src/app/RoleWorkbench.test.tsx
```

Expected: FAIL because the default is still `products` and `RoleWorkbench.tsx` does not exist.

- [ ] **Step 3: Implement the presentational component**

Use existing Ant Design `Card`, `Button`, `Space`, and `Typography`. Render:

```tsx
<section aria-label="今日经营角色工作台">
  <Card title="今日经营工作台">
    <Typography.Text>当前工作台：{model.label}</Typography.Text>
    <Typography.Paragraph>{model.description}</Typography.Paragraph>
    <Space wrap>
      {model.actions.map((action) => (
        <Button key={action.target} onClick={() => onNavigate(action.target)}>
          {action.label}
        </Button>
      ))}
    </Space>
    <Typography.Text type="secondary">
      快捷入口只用于工作编排，实际权限仍由服务端校验。
    </Typography.Text>
  </Card>
</section>
```

The component receives:

```ts
{
  role: string;
  onNavigate: (view: AdminViewKey) => void;
}
```

- [ ] **Step 4: Integrate without changing the operations resource**

In `AdminApp`, change `DEFAULT_ADMIN_VIEW` to `operations`. In the existing `view === "operations"` branch, render `RoleWorkbench` immediately before the existing `OperationsDashboardPage` inside a vertical `Space`. Pass `adminSession.role` and `setView`.

Do not move, duplicate, or modify `loadOperationsDashboard`; Shell refresh must continue incrementing only `operationsRefreshVersion`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/app/role-workbench.test.ts \
  apps/admin/src/app/RoleWorkbench.test.tsx \
  apps/admin/src/app/admin-view.test.ts \
  apps/admin/src/app/refresh-policy.test.ts
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/RoleWorkbench.tsx \
  apps/admin/src/app/RoleWorkbench.test.tsx \
  apps/admin/src/app/AdminApp.tsx \
  apps/admin/src/app/admin-view.ts \
  apps/admin/src/app/admin-view.test.ts
git commit -m "feat(admin): add L50 role workbench"
```

---

### Task 3: Prove the Workbench in the Real Browser Contract

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Consumes: authenticated `admin` fixture, `后台功能导航`, `今日经营角色工作台`
- Proves: default workbench, role profile, shortcut navigation, old 23-page coverage

- [ ] **Step 1: Add failing B2 source-contract expectations**

Before changing the smoke flow, add `assertB2RoleWorkbenchContract(smoke)` to require:

- login waits for `今日经营角色工作台`;
- the profile text is `当前工作台：经营负责人`;
- shortcuts are searched inside the workbench region, not the whole page;
- clicking the workbench `订单管理` shortcut activates the navigation `订单管理` button;
- the flow returns to `商品管理` before the existing A3/B1 request-isolation sequence;
- initial operations requests are fully settled and then the operations counter is reset before the legacy lazy-load assertions;
- all 23 registered navigation buttons remain covered.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: FAIL because the smoke script does not yet contain B2 workbench evidence.

- [ ] **Step 3: Extend the smoke flow**

Immediately after login:

1. scope the workbench with `page.getByRole('region', { name: '今日经营角色工作台' })`;
2. wait for `运营看板` so all initial operations resources have settled;
3. assert `当前工作台：经营负责人`;
4. click the workbench-scoped `订单管理` button;
5. assert the navigation-scoped `订单管理` button becomes active;
6. click the navigation-scoped `商品管理` button and wait for the existing product table;
7. reset only `operationsRequestCount` to zero before the existing A2 lazy-load evidence starts.

Do not weaken or remove the grouped-navigation assertions, 23/23 navigation loop, active-refresh checks, error/retry checks, session reload, forced render failure, logout, or cleanup.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
./node_modules/.bin/vitest run apps/admin/src
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
(cd apps/admin && node_modules/.bin/vite build)
```

Expected: all source contracts, all Admin tests, TypeScript, and production build pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/admin-e2e/admin-smoke.mjs \
  scripts/admin-e2e/contract.test.cjs
git commit -m "test(admin): prove L50 role workbench"
```

---

### Task 4: Verify Scope and Publish L50-B2

**Files:**
- Verify every changed path against this plan
- Add only the temporary full-gate workflow required for remote verification, then delete it after success

**Interfaces:**
- Verifies Tasks 1–3
- Produces a reviewable PR targeting `stable/l50-a3-4-business-base`

- [ ] **Step 1: Run the complete local Admin gate**

```bash
./node_modules/.bin/vitest run apps/admin/src
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
node --test scripts/admin-e2e/contract.test.cjs
(cd apps/admin && node_modules/.bin/vite build)
git diff --check
```

Expected: zero failed tests, zero TypeScript errors, successful Vite build, and no whitespace errors.

- [ ] **Step 2: Review exact scope**

Require:

- plan, role model/tests, workbench component/tests, Admin integration, default-view contract, and Admin E2E evidence only;
- no API, Prisma, migration, dependency, lockfile, miniapp, business-page, POS, connector, store/channel/device, all-channel aggregation, payment, refund, or inventory-accounting file;
- all 23 navigation labels and every existing page remain reachable;
- role metadata is not used to filter navigation or authorize actions.

- [ ] **Step 3: Publish the verified files**

Create `codex/l50-b2-role-workbench` from the current remote head of `stable/l50-a3-4-business-base`. Upload only B2 files with current blob-SHA guards and open a PR targeting the same stable branch.

- [ ] **Step 4: Run the limited self-hosted gate**

Use one serial job with:

```text
workspace concurrency = 1
Vitest max workers = 2
NODE_OPTIONS = --max-old-space-size=3072
cancel-in-progress = true
```

Require locked install, Prisma generation, B2 contracts, lint, serial typecheck, serial full tests, build, auth runtime, real PostgreSQL + Playwright Admin E2E, and exact cleanup.

- [ ] **Step 5: Remove the temporary workflow and review**

After a successful run, delete the temporary workflow, re-read the PR remote head and changed files, verify `behind 0`, mergeability, unresolved review threads, and perform a whole-diff review. Do not use the pre-deletion SHA as final evidence.

- [ ] **Step 6: Complete the stable checkpoint**

If the final review has no Critical or Important finding, merge with an expected-head guard and record the merge commit and successful Run. Do not begin all-channel orders, store/channel/device pages, RBAC, or any remote plan in the same PR.

## Plan Self-Review Result

- Spec coverage: B2 delivers the approved role-workbench slice and leaves later L50-B capabilities separate.
- Placeholder scan: no TBD, TODO, unspecified test, or incomplete implementation step exists.
- Type consistency: every shortcut target is `Exclude<AdminViewKey, 'login'>`; labels come from `ADMIN_FEATURES`; `RoleWorkbench` and `AdminApp` use the same navigation callback type.
- Scope: the selected approach changes only Admin presentation and default landing behavior, reuses the existing operations resource, and adds no persistence or authorization behavior.
- Safety: client role metadata remains recommendation-only; the server remains the authorization boundary.
