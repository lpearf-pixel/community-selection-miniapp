# L50-B1 Admin Shell and Grouped Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated Admin Shell's 23 flat navigation buttons with the approved grouped information architecture while preserving every existing page, label, request, refresh, session, and authorization behavior.

**Architecture:** The existing feature registry remains the single mapping from `AdminViewKey` to visible page metadata. A ten-section information-architecture registry groups those features; empty future sections remain defined but are omitted from the rendered navigation. `AdminShell` consumes a pure grouped model and renders a responsive top bar plus grouped navigation without adding routes, dependencies, permission filtering, or business state.

**Tech Stack:** React 18.3.1, TypeScript strict, Ant Design 5.23.0, Vitest 2.1.8, Vite 6.0.7, Playwright Admin E2E.

## Global Constraints

- Base the remote implementation on `stable/l50-a3-4-business-base`.
- Preserve all 23 non-login `AdminViewKey` values, labels, and page reachability.
- Preserve the authenticated landing view `products`.
- Do not change API paths, request payloads, Prisma, migrations, business pages, permissions, dependencies, or lockfiles.
- Navigation visibility is not authorization; do not apply `requiredPermissions` or role strings in B1.
- Define all ten approved top-level modules; omit only modules whose current feature list is empty.
- Do not implement POS, electronic-scale, AI recognition, connector, store/channel, device, sync, RBAC, or role-workbench capabilities.
- Keep refresh, logout, session, feature-local error isolation, hidden mounts, and stale-response behavior unchanged.
- Keep each existing page button's accessible name unchanged so the current Playwright page coverage remains valid.

---

### Task 1: Define the Ten-Section Navigation Contract

**Files:**
- Modify: `apps/admin/src/app/feature-registry.ts`
- Modify: `apps/admin/src/app/navigation.ts`
- Modify: `apps/admin/src/app/feature-registry.test.ts`
- Modify: `apps/admin/src/app/shell-model.ts`
- Modify: `apps/admin/src/app/shell-model.test.ts`

**Interfaces:**
- Consumes: `ADMIN_FEATURES`, `AdminViewKey`
- Produces: `AdminFeatureSection`, `ADMIN_NAVIGATION_SECTIONS`, `buildGroupedNavigation`, grouped `createShellNavigationModel`

- [ ] **Step 1: Write failing registry and shell-model tests**

Add tests that require the section order:

```ts
[
  ['today', '今日经营'],
  ['sales-fulfillment', '销售与履约'],
  ['catalog-pricing', '商品与价格'],
  ['inventory-supply', '库存与供应链'],
  ['membership-marketing', '会员与营销'],
  ['stores-channels', '门店与渠道'],
  ['finance-settlement', '财务与结算'],
  ['analytics', '数据分析'],
  ['operations-risk', '运维与风控'],
  ['system-management', '系统管理'],
]
```

Require the current projection to contain exactly seven visible groups, omit the three empty future groups, flatten to all 23 existing views exactly once, mark the active child and parent group, and call `onNavigate` with the selected `AdminViewKey`.

- [ ] **Step 2: Verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/app/feature-registry.test.ts \
  apps/admin/src/app/shell-model.test.ts
```

Expected: FAIL because the existing registry has eight legacy section values and `createShellNavigationModel` returns a flat array.

- [ ] **Step 3: Map every existing feature to the approved information architecture**

Use these exact ownership assignments:

```ts
operations -> today
groupBuys, failedGroupBuyClosure, orders, fulfillment, afterSales,
pickupWorkbench, deliveryReservation, deliveryRuleConfig -> sales-fulfillment
products -> catalog-pricing
inventory, purchasePlans, suppliers, batches, expiryAlerts, stockChecks -> inventory-supply
withdrawals, taxRecords, finance, refundLedger, rewardLedger -> finance-settlement
dashboardV2 -> analytics
alerts -> operations-risk
```

Keep `membership-marketing`, `stores-channels`, and `system-management` defined with no current pages.

- [ ] **Step 4: Implement grouped navigation projection**

`buildGroupedNavigation()` must return all ten section definitions with their matching registry items. `createShellNavigationModel()` must filter only empty groups and return:

```ts
{
  key: AdminFeatureSection;
  label: string;
  active: boolean;
  items: Array<{
    key: Exclude<AdminViewKey, 'login'>;
    label: string;
    active: boolean;
    onSelect: () => void;
  }>;
}
```

Retain `buildLegacyNavigation()` as a compatibility projection that flattens the grouped result.

- [ ] **Step 5: Verify GREEN**

Run the two focused Vitest files again. Expected: all tests pass with no failed assertion.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/feature-registry.ts \
  apps/admin/src/app/navigation.ts \
  apps/admin/src/app/feature-registry.test.ts \
  apps/admin/src/app/shell-model.ts \
  apps/admin/src/app/shell-model.test.ts
git commit -m "refactor(admin): group L50 navigation model"
```

---

### Task 2: Render the Responsive Grouped Admin Shell

**Files:**
- Modify: `apps/admin/src/app/AdminShell.tsx`
- Create: `apps/admin/src/app/AdminShell.css`
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Consumes: grouped `createShellNavigationModel`
- Preserves: `AdminShellProps`, exact button labels, `onRefresh`, `onLogout`, `children`
- Produces: accessible `nav[aria-label="后台功能导航"]` and seven current group headings

- [ ] **Step 1: Extend browser evidence before changing the Shell**

In `admin-smoke.mjs`, after authentication, require an accessible navigation region named `后台功能导航`; assert these seven visible headings in order:

```js
['今日经营', '销售与履约', '商品与价格', '库存与供应链',
 '财务与结算', '数据分析', '运维与风控']
```

Also assert `会员与营销`, `门店与渠道`, and `系统管理` are absent, while the existing 23-label navigation array and every exact button click remain unchanged.

Update `contract.test.cjs` to reject removal of the grouped-navigation visibility and empty-section assertions.

- [ ] **Step 2: Verify the new contract**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: the static E2E contract passes after the smoke evidence is present; the real browser evidence remains pending until the Shell implementation and full E2E gate.

- [ ] **Step 3: Implement the new Shell**

Render one outer `<section>` so the existing Playwright shell scope remains stable. Inside it:

- a top bar containing the existing `社区甄选管理后台` heading;
- current administrator identity and role;
- unchanged `刷新` and `退出登录` buttons;
- an optional live status line for `message`;
- a grouped `<nav aria-label="后台功能导航">`;
- one heading and one exact-label button per visible feature;
- `aria-current="page"` and Ant Design primary styling on the active item;
- the existing children in the main content area.

Do not introduce permission filtering, routing, icons that hide labels, collapsed-only navigation, or new state.

- [ ] **Step 4: Add responsive CSS**

Use a two-column Shell above 960px and a single-column grouped navigation below 960px. The mobile layout must keep every navigation button reachable without a hidden drawer or collapsed sidebar. Use only project CSS and existing Ant Design components.

- [ ] **Step 5: Run focused verification**

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/app/feature-registry.test.ts \
  apps/admin/src/app/shell-model.test.ts
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: model tests, typecheck, and all E2E contract tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/AdminShell.tsx \
  apps/admin/src/app/AdminShell.css \
  scripts/admin-e2e/admin-smoke.mjs \
  scripts/admin-e2e/contract.test.cjs
git commit -m "refactor(admin): render grouped responsive shell"
```

---

### Task 3: Verify Scope and Publish L50-B1

**Files:**
- Verify all changed files against this plan
- No production change after the final gate unless a failing check is reproduced first

**Interfaces:**
- Verifies all Task 1 and Task 2 contracts
- Produces a reviewable PR based on `stable/l50-a3-4-business-base`

- [ ] **Step 1: Run the complete local Admin gate**

```bash
./node_modules/.bin/vitest run apps/admin/src
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
node --test scripts/admin-e2e/contract.test.cjs
(cd apps/admin && node_modules/.bin/vite build)
```

Expected: 29 or more Admin test files pass, all contract tests pass, typecheck exits 0, and Vite build exits 0. Existing Ant Design `"use client"` and chunk-size warnings are allowed; new errors are not.

- [ ] **Step 2: Review the exact diff**

Confirm:

- only the plan, registry/navigation/model tests and implementation, Shell/CSS, and Admin E2E evidence changed;
- all 23 view keys and labels still appear exactly once;
- no API, Prisma, migration, dependency, lockfile, miniapp, POS, payment, inventory service, or business-page file changed;
- no empty placeholder page or future module button was added.

- [ ] **Step 3: Create the remote branch and apply the verified files**

Create `codex/l50-b1-admin-shell-navigation` from the current head of `stable/l50-a3-4-business-base`. Upload only the verified B1 files, preserving optimistic blob-SHA checks.

- [ ] **Step 4: Open the PR**

Target `stable/l50-a3-4-business-base`. Link #84, state the exclusions, list the local test counts, and state that POS/electronic-scale/AI/connector work remains an unexecuted future plan.

- [ ] **Step 5: Run the real PostgreSQL + Playwright gate**

Use the established self-hosted Runner workflow. Require lint, typecheck, all tests, build, PostgreSQL initialization, Admin Playwright E2E, and cleanup to succeed. Do not weaken assertions or mock successful business responses.

- [ ] **Step 6: Complete the branch**

After a successful gate, verify the PR head, changed-file scope, unresolved review threads, and mergeability. Then follow the approved stable-checkpoint workflow; do not start L50-B2 in this task.

## Plan Self-Review Result

- Spec coverage: all ten approved information-architecture modules are defined; current non-empty groups render; all 23 existing views remain reachable.
- Deliberate exclusions: role workbenches, authentication/RBAC changes, store/channel/device pages, all-channel aggregation, POS, weighing, AI, and connector work remain outside B1.
- Placeholder scan: no TBD, TODO, unspecified implementation step, or fake page is present.
- Type consistency: `AdminFeatureSection` is the shared key type for section definitions, feature entries, grouped projections, and Shell models.
- Safety: authorization remains server-side; no data, API, payment, inventory, or persistence behavior changes.
