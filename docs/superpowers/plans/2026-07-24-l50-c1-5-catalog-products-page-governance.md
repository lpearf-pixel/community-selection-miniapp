# L50-C1.5 Catalog Products Page Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Split the 353-line catalog products page into typed table, form, and orchestration boundaries without behavior changes.

**Architecture:** Keep resource state, loading, abort handling, editing state, messages and mutations in `CatalogProductsPage`; extract synchronous views only.

**Tech Stack:** React 18, TypeScript 5.7, Ant Design, Vitest, Vite, Playwright.

## Global Constraints

- `CatalogProductsPage.tsx` must be at most 200 lines.
- Preserve endpoints, concurrent request timing, copy, accessibility, values, units and temporary-only behavior.
- No real save API, lazy loading, Prisma, dependency, lockfile, group-buy, withdrawal, miniapp or POS changes.

### Task 1: RED structure contract

**Files:** Create `apps/admin/src/features/catalog/products/catalog-products-page-structure.test.ts`.

- [ ] Require the page to be at most 200 lines.
- [ ] Require `CatalogProductsTable` and `CatalogProductForm` source files, exports and renders.
- [ ] Forbid inline Table, Form, Input, InputNumber, Select, Switch and `columns={[`.
- [ ] Run the focused test and confirm failure on the 353-line page and missing files.

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/catalog/products/catalog-products-page-structure.test.ts
```

### Task 2: Extract the table

**Files:** Create `CatalogProductsTable.tsx`; modify `CatalogProductsPage.tsx`.

```ts
type CatalogProductsTableProps = {
  products: Product[];
  onCreate: () => void;
  onEdit: (product: Product) => void;
  onToggleStatus: (product: Product) => void;
};
```

- [ ] Move the existing card, 11 columns, values, formatting and buttons unchanged.
- [ ] Wire the three existing page handlers through callbacks.

### Task 3: Extract the form and reach GREEN

**Files:** Create `CatalogProductForm.tsx`; modify `CatalogProductsPage.tsx`.

```ts
type CatalogProductFormProps = {
  product: Product;
  categoryOptions: Array<{ label: string; value: string }>;
  onProductChange: (patch: Partial<Product>) => void;
  onSave: () => void;
};
```

- [ ] Move all fields, values, min constraints, conversions, options, accessible name and save button unchanged.
- [ ] Keep product-state merging and save-message side effects in the page.
- [ ] Run structure, API, page-model and strict TypeScript; require the page at most 200 lines.

### Task 4: Full verification and delivery

- [ ] Run Admin/full workspace tests, lint, bounded typecheck, production build and source contracts.
- [ ] Run authentication runtime, PostgreSQL and Playwright Admin flow on the self-hosted Runner.
- [ ] Review exact scope and implementation blob identity.
- [ ] Remove the temporary workflow, verify final head, then squash merge.
