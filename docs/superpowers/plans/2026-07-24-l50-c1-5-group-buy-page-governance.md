# L50-C1.5 Group Buy Page Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 368-line Admin group-buy page into typed list, closure-workbench, and orchestration boundaries without changing behavior.

**Architecture:** Keep all state, API calls, abort handling, stale-response protection, mutation effects, and error isolation in `GroupBuyManagementPage`. Extract two synchronous presentation components that receive typed data and callbacks only.

**Tech Stack:** React 18, TypeScript 5.7, Ant Design, Vitest, Vite, Node test runner, Playwright.

## Global Constraints

- `GroupBuyManagementPage.tsx` must be at most 200 lines.
- Do not change API paths, DTOs, permissions, refund/closure rules, copy, request timing, date formatting, or money formatting.
- Do not add lazy loading, dependencies, Prisma changes, migrations, or lockfile changes.
- Do not modify catalog, withdrawals, miniapp, POS, device, or store code.
- Keep API calls, AbortController ownership, generation guards, state, and side effects in `GroupBuyManagementPage`.

---

### Task 1: Lock the source boundaries with a failing contract

**Files:**

- Create: `apps/admin/src/features/sales/group-buys/group-buy-page-structure.test.ts`

**Interfaces:**

- Consumes: current `GroupBuyManagementPage.tsx`.
- Produces: static contract for `GroupBuyListCard` and `GroupBuyClosureWorkbench`.

- [ ] **Step 1: Write the structure contract**

The test requires a page of at most 200 lines, imports and renders both presentation
components, verifies their source files and exports exist, and forbids inline `Table`,
`Card`, `Select`, and `columns={[` evidence in the orchestrator.

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/features/sales/group-buys/group-buy-page-structure.test.ts \
  --maxWorkers=2 --minWorkers=1
```

Expected: FAIL because the page has 368 lines and both child files are absent.

- [ ] **Step 3: Commit the RED contract**

```bash
git add apps/admin/src/features/sales/group-buys/group-buy-page-structure.test.ts
git commit -m "test(admin): lock group buy page boundaries"
```

### Task 2: Extract the group-buy list

**Files:**

- Create: `apps/admin/src/features/sales/group-buys/GroupBuyListCard.tsx`
- Modify: `apps/admin/src/features/sales/group-buys/GroupBuyManagementPage.tsx`

**Interfaces:**

```ts
export type GroupBuyListCardProps = {
  groupBuys: GroupBuy[];
  onClone: (groupBuy: GroupBuy) => void;
};
```

- [ ] **Step 1: Move the existing list card unchanged**

Move all eight columns, render callbacks, formats, fallbacks and the “一键再开团”
button into `GroupBuyListCard`. Do not make the child async.

- [ ] **Step 2: Wire the component**

```tsx
<GroupBuyListCard
  groupBuys={state.data}
  onClone={(groupBuy) => void cloneExistingGroupBuy(groupBuy)}
/>
```

- [ ] **Step 3: Run focused tests and TypeScript**

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/features/sales/group-buys/group-buy-page-structure.test.ts \
  apps/admin/src/features/sales/group-buys/api.test.ts \
  apps/admin/src/features/sales/group-buys/page-model.test.ts \
  --maxWorkers=2 --minWorkers=1
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: API and model tests plus TypeScript pass; structure remains RED until the
closure workbench is extracted and the page reaches the limit.

### Task 3: Extract the closure workbench and reach GREEN

**Files:**

- Create: `apps/admin/src/features/sales/group-buys/GroupBuyClosureWorkbench.tsx`
- Modify: `apps/admin/src/features/sales/group-buys/GroupBuyManagementPage.tsx`

**Interfaces:**

```ts
export type GroupBuyClosureWorkbenchProps = {
  groupBuys: GroupBuy[];
  state: ClosureWorkbenchState;
  onSelect: (groupBuyId: string) => void;
  onReload: () => void;
  onMarkFailed: () => void;
  onCloseUnpaidOrders: () => void;
  onCloseFinally: () => void;
  onConfirmRefund: (order: ManualRefundOrder) => void;
};
```

- [ ] **Step 1: Move the workbench presentation unchanged**

Move the disclaimer, select options, four workbench buttons, closure summary,
blockers and nine-column manual refund table. Keep all copy and formatting exact.

- [ ] **Step 2: Wire handlers from the page**

The page's `onSelect` must update `selectedClosureGroupBuyIdRef`, call
`selectClosureGroupBuy`, then invoke `reloadClosureWorkbench`. Other callbacks
must delegate to the existing async handlers without moving side effects.

- [ ] **Step 3: Verify GREEN**

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/features/sales/group-buys/group-buy-page-structure.test.ts \
  apps/admin/src/features/sales/group-buys/api.test.ts \
  apps/admin/src/features/sales/group-buys/page-model.test.ts \
  --maxWorkers=2 --minWorkers=1
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
wc -l apps/admin/src/features/sales/group-buys/GroupBuyManagementPage.tsx
```

Expected: all focused tests pass, TypeScript exits 0, and the page is at most 200 lines.

- [ ] **Step 4: Commit the presentation split**

```bash
git add apps/admin/src/features/sales/group-buys
git commit -m "refactor(admin): split group buy page views"
```

### Task 4: Verify and deliver

**Files:**

- Verify every file changed from `stable/l50-a3-4-business-base`.
- Modify existing evidence only if an assertion reads JSX moved out of the page.

**Interfaces:**

- Consumes: final T3 source.
- Produces: a reviewed PR with local and remote evidence.

- [ ] **Step 1: Run the complete gate**

```bash
set -e
./node_modules/.bin/vitest run apps/admin/src --maxWorkers=2 --minWorkers=1
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
(cd apps/admin && ./node_modules/.bin/vite build)
node --test scripts/admin-e2e/contract.test.cjs
git diff --check
```

Expected: all tests pass; TypeScript, Vite, contracts, and diff check exit 0.

- [ ] **Step 2: Review exact scope**

Expected paths are the page, two presentation components, one structure contract,
this design and this plan, plus a narrowly necessary evidence-routing change only.

- [ ] **Step 3: Run the remote gate**

Use one resource-limited self-hosted job for locked install, Prisma generation,
workspace lint/typecheck/test/build, authentication runtime, PostgreSQL and
Playwright Admin flow. Remove the temporary workflow after success.

- [ ] **Step 4: Merge only after final-head verification**

Confirm final diff and byte identity, no Critical/Important findings or unresolved
threads, read the exact final PR head SHA, then squash merge with that SHA as the
concurrency guard.
