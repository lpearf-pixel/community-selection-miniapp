# L50-C1.5 Tax Review Page Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 411-line Admin tax review page into typed filter, table, drawer, and orchestration boundaries without changing behavior.

**Architecture:** Keep all state, API calls, abort handling, mutation effects, and error isolation in `TaxReviewPage`. Extract three synchronous presentation components that receive typed data and callbacks only.

**Tech Stack:** React 18, TypeScript 5.7, Ant Design, Vitest, Vite, Node test runner, Playwright.

## Global Constraints

- `TaxReviewPage.tsx` must be at most 200 lines.
- Do not change API paths, DTOs, permissions, masking, copy, optimistic concurrency, idempotency, request timing, or pagination.
- Do not add lazy loading, dependencies, Prisma changes, migrations, or lockfile changes.
- Do not modify group-buy, catalog, withdrawals, miniapp, POS, device, or store code.
- Keep API calls, AbortController ownership, state, and side effects in `TaxReviewPage`.

---

### Task 1: Lock the source boundaries with a failing contract

**Files:**

- Create: `apps/admin/src/features/finance/tax-review/tax-review-page-structure.test.ts`

**Interfaces:**

- Consumes: current `TaxReviewPage.tsx`.
- Produces: static contract for `TaxReviewFilters`, `TaxReviewTable`, and `TaxReviewDrawer`.

- [ ] **Step 1: Write the structure contract**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const featureRoot = path.resolve(
  process.cwd(),
  'apps/admin/src/features/finance/tax-review',
);

describe('tax review page source boundaries', () => {
  it('keeps the orchestrator focused and delegates three views', () => {
    const page = fs.readFileSync(
      path.join(featureRoot, 'TaxReviewPage.tsx'),
      'utf8',
    );
    expect(page.split('\n')).toHaveLength(expect.any(Number));
    expect(page.split('\n').length).toBeLessThanOrEqual(201);
    for (const component of [
      'TaxReviewFilters',
      'TaxReviewTable',
      'TaxReviewDrawer',
    ]) {
      expect(page).toContain(`<${component}`);
      expect(
        fs.existsSync(path.join(featureRoot, `${component}.tsx`)),
      ).toBe(true);
    }
    expect(page).not.toMatch(/<Table\b/);
    expect(page).not.toMatch(/<Drawer\b/);
    expect(page).not.toMatch(/<DatePicker\.RangePicker\b/);
  });
});
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/features/finance/tax-review/tax-review-page-structure.test.ts \
  --maxWorkers=2 --minWorkers=1
```

Expected: FAIL because the page exceeds 200 lines and the three child files do not exist.

- [ ] **Step 3: Commit the RED contract**

```bash
git add apps/admin/src/features/finance/tax-review/tax-review-page-structure.test.ts
git commit -m "test(admin): lock tax review page boundaries"
```

### Task 2: Extract filters and table

**Files:**

- Create: `apps/admin/src/features/finance/tax-review/TaxReviewFilters.tsx`
- Create: `apps/admin/src/features/finance/tax-review/TaxReviewTable.tsx`
- Modify: `apps/admin/src/features/finance/tax-review/TaxReviewPage.tsx`

**Interfaces:**

- `TaxReviewFiltersProps`: `exporting`, `onFiltersChange`, `onQuery`, `onExport`.
- `TaxReviewTableProps`: `data`, `refreshing`, `onPageChange`, `onOpenDetail`.

- [ ] **Step 1: Move the existing filter controls unchanged**

Create `TaxReviewFilters.tsx` with the existing Input, three Select controls,
RangePicker, query button, and export button. Implement field changes through:

```ts
onFiltersChange: (patch: Partial<TaxReviewQuery>) => void;
```

The query and export callbacks are:

```ts
onQuery: () => void;
onExport: () => void;
```

- [ ] **Step 2: Move the existing table unchanged**

Create `TaxReviewTable.tsx` with:

```ts
export type TaxReviewTableProps = {
  data: TaxReviewList;
  refreshing: boolean;
  onPageChange: (page: number) => void;
  onOpenDetail: (row: TaxReviewRow) => void;
};
```

Keep all seven columns, render functions, pagination fields, and button copy unchanged.

- [ ] **Step 3: Wire both components from the page**

Use:

```tsx
<TaxReviewFilters
  exporting={exporting}
  onFiltersChange={(patch) =>
    setDraftFilters((current) => ({ ...current, ...patch }))
  }
  onQuery={applyFilters}
  onExport={() => void exportCsv()}
/>
<TaxReviewTable
  data={state.data}
  refreshing={state.status === 'refreshing'}
  onPageChange={setPage}
  onOpenDetail={(row) => void openDetail(row)}
/>
```

- [ ] **Step 4: Run focused tests and TypeScript**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/features/finance/tax-review/tax-review-page-structure.test.ts \
  apps/admin/src/features/finance/tax-review/api.test.ts \
  apps/admin/src/features/a3-4-pages-source-contract.test.ts \
  --maxWorkers=2 --minWorkers=1
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: existing eight tests and TypeScript pass; the structure contract remains RED only until the drawer is extracted and the orchestrator reaches the line limit.

### Task 3: Extract the review drawer and reach GREEN

**Files:**

- Create: `apps/admin/src/features/finance/tax-review/TaxReviewDrawer.tsx`
- Modify: `apps/admin/src/features/finance/tax-review/TaxReviewPage.tsx`

**Interfaces:**

- `TaxReviewDrawerProps`: `detail`, `form`, `submitting`, `onClose`, `onSubmit`.

- [ ] **Step 1: Move the drawer and form unchanged**

Create the typed boundary:

```ts
export type TaxReviewDrawerProps = {
  detail: TaxReviewDetail | null;
  form: FormInstance<TaxReviewPayload>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
};
```

Move the existing Drawer, disclaimer, commission summary, seven Form items,
hidden `expected_updated_at`, and save button without changing copy or rules.

- [ ] **Step 2: Wire the drawer from the page**

Use:

```tsx
<TaxReviewDrawer
  detail={detail}
  form={form}
  submitting={submitting}
  onClose={() => setDetail(null)}
  onSubmit={() => void submit()}
/>
```

- [ ] **Step 3: Verify GREEN**

Run:

```bash
./node_modules/.bin/vitest run \
  apps/admin/src/features/finance/tax-review/tax-review-page-structure.test.ts \
  apps/admin/src/features/finance/tax-review/api.test.ts \
  apps/admin/src/features/a3-4-pages-source-contract.test.ts \
  --maxWorkers=2 --minWorkers=1
./node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
wc -l apps/admin/src/features/finance/tax-review/TaxReviewPage.tsx
```

Expected: all focused tests pass, TypeScript exits 0, and the page is at most 200 lines.

- [ ] **Step 4: Commit the presentation split**

```bash
git add \
  apps/admin/src/features/finance/tax-review/TaxReviewPage.tsx \
  apps/admin/src/features/finance/tax-review/TaxReviewFilters.tsx \
  apps/admin/src/features/finance/tax-review/TaxReviewTable.tsx \
  apps/admin/src/features/finance/tax-review/TaxReviewDrawer.tsx
git commit -m "refactor(admin): split tax review page views"
```

### Task 4: Verify and deliver

**Files:**

- Verify every file changed from the C1.5-T1 baseline.
- Modify `scripts/admin-e2e/contract.test.cjs` only if a current assertion reads evidence moved from `TaxReviewPage.tsx`.

**Interfaces:**

- Consumes: final T2 source.
- Produces: a reviewed PR with local and remote evidence.

- [ ] **Step 1: Run the complete local gate**

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

```bash
git diff --stat codex/l50-c1-5-orders-page-governance...HEAD
git diff --name-only codex/l50-c1-5-orders-page-governance...HEAD
```

Expected: only the tax-review feature, its structure contract, necessary evidence routing, and this spec/plan.

- [ ] **Step 3: Publish and run the remote gate**

Create the remote branch from `df6aead390cbc43f3bd71c2e9ce3edfecb2f1faa`,
publish the verified files byte-for-byte, and open a PR into
`stable/l50-a3-4-business-base`. Use a single resource-limited Actions job to
run workspace lint/typecheck/test/build and the authenticated PostgreSQL +
Playwright Admin flow.

- [ ] **Step 4: Merge only after final-head verification**

Delete the temporary workflow, confirm the final delivery diff and byte
identity, confirm no Critical/Important findings or unresolved review threads,
read the exact final PR head SHA, and squash merge with that SHA as the
concurrency guard.
