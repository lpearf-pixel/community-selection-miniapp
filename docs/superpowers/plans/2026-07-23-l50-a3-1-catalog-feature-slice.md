# L50-A3.1 Catalog Feature Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing product/category Admin page out of `AdminApp` into an isolated catalog feature with typed loading, local refresh/retry, and unchanged UI behavior.

**Architecture:** `AdminApp` remains the authenticated composition root and keeps the catalog feature mounted for the authenticated session, hiding it outside the existing `products` view so temporary editor/status state preserves its prior navigation lifetime. `CatalogProductsPage` owns category/product DTOs, initial loading, errors, retry, local product editor state, and the current non-persistent status toggle. A catalog-specific reducer keeps local toggles separate from request success/error state. The Shell refresh increments only the active feature version; all other mutable legacy views remain on `refreshLegacyFeatures` until later A3 checkpoints.

**Tech Stack:** React 18.3.1, Ant Design 5.23.0, TypeScript strict/noImplicitAny, Vite 6, Vitest 2, Node 20.19.0, pnpm 9.15.4, Playwright 1.61.1.

## Global Constraints

- Base branch is `stable/l50-a2-business-base` at merge commit `906bf828254006b133a18a9eaeb62d1d22597bd2`.
- Implementation branch is `codex/l50-a3-1-catalog-feature-slice`.
- Do not change dependencies, `pnpm-lock.yaml`, Prisma schema, migrations, API routes, payloads, response envelopes, permissions, payment, refund, inventory, miniapp, POS, or persistent product behavior.
- Preserve all 23 L49 navigation labels and their order.
- Preserve `App === AdminApp`, same-origin `/api` behavior, `credentials: include`, and existing Session Cookie behavior.
- Keep the existing product editor copy, columns, form defaults, unit semantics, money formatting, and page-local non-persistent status toggle exactly.
- Do not add a product persistence endpoint; the existing copy must continue to say persistence is a later stage.
- The catalog failure state must remain inside the feature workspace and must not disable Shell navigation, finance, operations, or any legacy view.
- Do not remove `refreshLegacyFeatures` yet; only remove category/product requests and state from it.
- Do not submit `reports/` or a temporary workflow in the final PR.

---

### Task 1: Define the catalog DTO and loader boundary

**Files:**
- Create: `apps/admin/src/features/catalog/products/types.ts`
- Create: `apps/admin/src/features/catalog/products/api.ts`
- Create: `apps/admin/src/features/catalog/products/api.test.ts`

**Interfaces:**
- Consumes: `JsonRequester` from `apps/admin/src/shared/api/client.ts` and `adminJsonRequest` from `apps/admin/src/shared/api/admin-api.ts`.
- Produces: `Category`, `Product`, `EMPTY_PRODUCT`, `CatalogProductsData`, and `loadCatalogProducts(request, signal?)`.

- [ ] **Step 1: Write the failing loader contract**

```ts
import { describe, expect, it, vi } from "vitest";
import { loadCatalogProducts } from "./api";

describe("catalog products loader", () => {
  it("loads the existing category and product endpoints", async () => {
    const request = vi.fn(async (path: string) =>
      path === "/api/categories"
        ? [{ id: "category-1", name: "蔬菜" }]
        : { items: [{ id: "product-1", name: "青菜" }] },
    );

    const result = await loadCatalogProducts(request);

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/categories",
      "/api/products",
    ]);
    expect(result.categories).toEqual([{ id: "category-1", name: "蔬菜" }]);
    expect(result.products).toEqual([{ id: "product-1", name: "青菜" }]);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/catalog/products/api.test.ts
```

Expected: fail because `api.ts` does not exist.

- [ ] **Step 3: Add exact DTOs and loader**

`types.ts` moves the current `CommissionType`, `ProductStatus`, `Category`, `Product`, and `emptyProduct` definitions from `AdminApp.tsx` without renaming fields or changing units. Export the constant as `EMPTY_PRODUCT` and add:

```ts
export type CatalogProductsData = {
  categories: Category[];
  products: Product[];
};
```

`api.ts`:

```ts
import type { JsonRequester } from "../../../shared/api/client";
import { adminJsonRequest } from "../../../shared/api/admin-api";
import type { CatalogProductsData, Category, Product } from "./types";

export async function loadCatalogProducts(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<CatalogProductsData> {
  const [categories, products] = await Promise.all([
    request<Category[]>("/api/categories", { signal }),
    request<{ items: Product[] }>("/api/products", { signal }),
  ]);
  return { categories, products: products.items };
}
```

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/catalog/products/api.test.ts
```

Expected: one catalog loader test passes.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/catalog/products
git commit -m "refactor(admin): add catalog data boundary"
```

---

### Task 2: Extract the product page with feature-local state

**Files:**
- Create: `apps/admin/src/features/catalog/products/CatalogProductsPage.tsx`
- Create: `apps/admin/src/features/catalog/products/page-model.ts`
- Create: `apps/admin/src/features/catalog/products/page-model.test.ts`

**Interfaces:**
- Consumes: `loadCatalogProducts`, catalog DTOs, `FeatureResourceState`, `reduceFeatureResource`, `initialFeatureResourceState`, and `featureErrorMessage`.
- Produces: `CatalogProductsPage({ refreshVersion })` and the pure helpers `catalogCategoryOptions(categories)` and `toggleCatalogProductStatus(products, productId)`.

- [ ] **Step 1: Write failing pure model tests**

```ts
import { describe, expect, it } from "vitest";
import {
  catalogCategoryOptions,
  toggleCatalogProductStatus,
} from "./page-model";

describe("catalog product page model", () => {
  it("maps categories to the existing select options", () => {
    expect(catalogCategoryOptions([{ id: "c1", name: "蔬菜" }])).toEqual([
      { label: "蔬菜", value: "c1" },
    ]);
  });

  it("toggles only the selected product between active and inactive", () => {
    const products = [
      { id: "p1", status: "active" },
      { id: "p2", status: "draft" },
    ] as const;
    const result = toggleCatalogProductStatus(products, "p1");
    expect(result.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "p1", status: "inactive" },
      { id: "p2", status: "draft" },
    ]);
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/catalog/products/page-model.test.ts
```

Expected: fail because `page-model.ts` does not exist.

- [ ] **Step 3: Implement the pure page model**

```ts
import type { Category, Product } from "./types";

export function catalogCategoryOptions(categories: Category[]) {
  return categories.map((category) => ({
    label: category.name,
    value: category.id,
  }));
}

export function toggleCatalogProductStatus(
  products: readonly Product[],
  productId: string,
): Product[] {
  return products.map((product) =>
    product.id === productId
      ? {
          ...product,
          status: product.status === "active" ? "inactive" : "active",
        }
      : product,
  );
}
```

- [ ] **Step 4: Run model GREEN**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/catalog/products/page-model.test.ts
```

Expected: both model tests pass.

- [ ] **Step 5: Move the current products JSX and lifecycle into `CatalogProductsPage`**

The page must:

- accept `refreshVersion: number`;
- call `loadCatalogProducts` on mount and when `refreshVersion` changes;
- abort the previous request group during refresh or unmount;
- show `Spin` when no data exists;
- show an `Alert` with a local `重试` button when loading fails;
- keep prior data visible while refreshing;
- keep the current `商品列表` card, table columns, row key, money formatting, product editor form, labels, defaults, unit options, commission controls, and wording;
- keep `新增商品`, `编辑`, and status toggle state entirely inside the page;
- keep the two existing messages:
  - `正在新增商品，保存接口将在后续阶段接入。`
  - `正在编辑商品，保存接口将在后续阶段接入。`
  - `已在页面临时切换上下架状态，持久化接口将在后续阶段接入。`
- not write to `AdminShell` message state;
- not add any mutation API.

- [ ] **Step 6: Run focused tests, typecheck, and build**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/catalog/products
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
```

Expected: focused tests pass and both static gates exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/catalog/products
git commit -m "refactor(admin): extract catalog products page"
```

---

### Task 3: Integrate active catalog refresh and remove global catalog state

**Files:**
- Modify: `apps/admin/src/app/refresh-policy.ts`
- Modify: `apps/admin/src/app/refresh-policy.test.ts`
- Modify: `apps/admin/src/app/AdminApp.tsx`

**Interfaces:**
- Consumes: `AdminViewKey` and `CatalogProductsPage`.
- Produces: `adminRefreshTarget(view): "catalog" | "finance" | "operations" | "legacy"` and an `AdminApp` that no longer owns catalog DTOs, requests, editor state, or JSX.

- [ ] **Step 1: Extend the failing refresh/source contract**

The test must require:

```ts
expect(adminRefreshTarget("products")).toBe("catalog");
```

It must also read `AdminApp.tsx` and assert:

```ts
expect(source).not.toContain('"/api/categories"');
expect(source).not.toContain('"/api/products"');
expect(source).not.toContain("type Product =");
expect(source).not.toContain("type Category =");
expect(source).toContain("CatalogProductsPage");
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/app/refresh-policy.test.ts
```

Expected: fail because `products` still targets `legacy` and `AdminApp` still contains the catalog implementation.

- [ ] **Step 3: Implement catalog refresh routing**

```ts
export type AdminRefreshTarget =
  | "catalog"
  | "finance"
  | "operations"
  | "legacy";

export function adminRefreshTarget(view: AdminViewKey): AdminRefreshTarget {
  if (view === "products") return "catalog";
  if (view === "finance" || view === "operations") return view;
  return "legacy";
}
```

In `AdminApp`:

- import `CatalogProductsPage`;
- add `catalogRefreshVersion`;
- increment it in `refreshActiveFeature` when the target is `catalog`;
- render `<CatalogProductsPage refreshVersion={catalogRefreshVersion} />`;
- keep the catalog page mounted behind `hidden={view !== "products"}` so navigation does not reset the existing temporary editor/status state;
- remove catalog DTOs, `EMPTY_PRODUCT`, category/product state, catalog memo, catalog handlers, and inline products JSX;
- remove `/api/categories` and `/api/products` from `refreshLegacyFeatures`;
- leave every remaining endpoint, state, mutation handler, view, and post-mutation legacy refresh unchanged;
- keep calling `refreshLegacyFeatures` after authentication while the remaining legacy views still depend on that preload; category/product endpoints stay absent, so catalog still mounts and loads only itself.

- [ ] **Step 4: Run GREEN and all Admin gates**

Run:

```bash
pnpm --filter @community-selection/admin test
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
```

Expected: all Admin tests pass; `AdminApp.tsx` contains neither catalog endpoint nor catalog DTO/page implementation.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app apps/admin/src/features/catalog/products
git commit -m "refactor(admin): isolate catalog refresh"
```

---

### Task 4: Extend browser contracts for catalog isolation

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Consumes: the existing real Session login, 23-navigation smoke, A2 request counters, retry assertions, and cleanup state machine.
- Produces: evidence that catalog loading, refresh, failure, retry, and navigation remain local to the catalog feature.

- [ ] **Step 1: Add failing source contracts**

The contract must require the smoke to:

- count `/api/categories` and `/api/products` requests as the catalog group;
- prove the default products view loads only the two catalog endpoint identities after Session login; React StrictMode may duplicate the initial mount attempt, so assert balanced per-endpoint counts rather than a total of exactly two requests;
- click Shell refresh on products and prove only catalog counts increase among extracted catalog/finance/operations groups;
- fail the first category request on an isolated catalog refresh with a `500` envelope;
- prove local catalog error and `重试` are visible while navigation remains usable;
- navigate to another real feature during the catalog error, return, and prove the catalog error plus editor draft are preserved;
- retry against both real catalog endpoints, require successful response envelopes, and prove the refresh completes with `商品列表` plus the editor draft intact;
- continue the existing finance/operations and 23-navigation assertions;
- continue logout and exact cleanup.

- [ ] **Step 2: Run contract RED**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: fail because catalog isolation assertions are absent.

- [ ] **Step 3: Implement minimal Playwright assertions**

Use per-endpoint request counters, refresh-relative baselines, and a route handler limited to the first category failure. Do not mock login, Session Cookie, successful catalog data, finance success, operations retry success, or any legacy page.

- [ ] **Step 4: Run contract GREEN**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs scripts/admin-e2e/run-cleanup.test.cjs
```

Expected: all source and cleanup contracts pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/admin-e2e/admin-smoke.mjs scripts/admin-e2e/contract.test.cjs
git commit -m "test(admin): cover catalog feature isolation"
```

---

### Task 5: Full gate, scope audit, PR, and stable checkpoint

**Files:**
- Modify only when required for accurate task evidence: PR description and issue #84 comment.

**Interfaces:**
- Verifies the A3.1 boundary and creates the next stable checkpoint.

- [ ] **Step 1: Audit the diff**

Run:

```bash
git diff --stat stable/l50-a2-business-base...HEAD
git diff --name-only stable/l50-a2-business-base...HEAD
```

Expected final paths:

- this plan;
- `apps/admin/src/features/catalog/products/**`;
- `apps/admin/src/app/AdminApp.tsx`;
- `apps/admin/src/app/refresh-policy.ts`;
- `apps/admin/src/app/refresh-policy.test.ts`;
- Admin E2E smoke/contracts.

No dependency, lockfile, Prisma, migration, API route, miniapp, payment, refund, inventory service, POS, report, or unrelated documentation file may appear.

- [ ] **Step 2: Run the complete repository gate**

Run on the final HEAD:

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

Expected: every command exits 0; browser smoke covers all 23 navigation items and catalog/finance/operations isolation; cleanup removes the current Run's browser, API/Admin children, administrator, PostgreSQL volume, and network.

- [ ] **Step 3: Review requirements line by line**

Confirm:

- catalog owns its DTOs, loader, state, error, retry, editor, and rendering;
- catalog endpoints do not occur in `AdminApp`;
- Shell refresh on products targets only catalog;
- the remaining legacy refresh and mutation handlers are unchanged;
- catalog failure cannot disable Shell or another feature;
- existing product actions remain non-persistent;
- no permission metadata is treated as authorization;
- no PII, credentials, fixture secrets, or broad cleanup is introduced.

- [ ] **Step 4: Open and review the implementation PR**

Open a draft PR from `codex/l50-a3-1-catalog-feature-slice` to `stable/l50-a2-business-base`. Link #84 and this plan, include exact local/Runner commands and Run IDs, and state that A3.2 starts only after merge and a new stable checkpoint. Mark ready only after final HEAD is green and an independent review has no unresolved Critical or Important findings.

- [ ] **Step 5: Merge and checkpoint**

Squash merge after approval and create `stable/l50-a3-1-business-base` at the verified merge commit. Re-read the remote PR head and merge commit after publication; do not rely on local SHAs.

## Plan Self-Review Result

- Spec coverage: this checkpoint advances the approved L50-A no-behavior refactor by extracting the first remaining mutable feature without changing endpoints or persistence.
- Scope: catalog is one independent feature; sales/fulfillment/after-sales and inventory/supply remain separate A3 checkpoints so a reviewer can reject one domain without blocking the others.
- Placeholder scan: the plan contains no unresolved implementation marker or undefined acceptance step.
- Type consistency: `CatalogProductsData`, `CatalogProductsPage`, `catalogRefreshVersion`, and the `"catalog"` refresh target have one definition and matching consumers.
- Safety: no API, schema, dependency, authorization, payment, refund, inventory, miniapp, POS, destructive cleanup, or production data change is included.
