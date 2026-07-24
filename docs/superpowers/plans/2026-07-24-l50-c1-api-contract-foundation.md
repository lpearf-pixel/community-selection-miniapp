# L50-C1 API Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the protected Admin order list the first bounded, traceable V1
API contract without changing its user-visible behavior or database schema.

**Architecture:** Add backward-compatible V1 contract primitives to the shared
package, then adopt them only in the Admin order list. Keep query parsing as a
pure unit, keep the existing data-scope predicate, and update the Admin page to
consume nested pagination metadata. Runtime evidence remains PostgreSQL plus
Playwright.

**Tech Stack:** TypeScript, Fastify 5, Prisma 6, React 18, Ant Design, Vitest,
Node test runner, PostgreSQL, Playwright.

## Global Constraints

- Base: `stable/l50-a3-4-business-base` at
  `57f62dd933d41a742db07d565b43bb62092497ef`.
- No Prisma schema or migration changes.
- No POS, device, store, channel-write, inbox, or outbox implementation.
- Preserve permissions, data scope, masking, deterministic ordering, details,
  status updates, pickup verification, exports, refresh, and retry.
- `page <= 10_000`; `page_size <= 100`; maximum Prisma offset `999_900`.
- Keep legacy shared `ok` and `fail` behavior unchanged.
- Use RED, GREEN, and refactor for every production behavior change.
- Runner limits remain one workspace task at a time, Vitest one to two
  workers, and a 3 GiB Node heap.

---

### Task 1: Shared V1 contract primitives

**Files:**

- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/api-contract.test.ts`

**Interfaces:**

- Produces `CanonicalId`, `ExpectedVersion`, `IdempotencyKey`,
  `ApiContractSuccess`, `ApiContractError`, `PaginationMetadata`,
  `PaginatedData`, `contractOk`, `contractFail`, and
  `buildPaginationMetadata`.
- Preserves `ok`, `fail`, and `formatYuan`.

- [ ] **Step 1: Write failing shared-contract tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildPaginationMetadata,
  contractFail,
  contractOk,
} from '../src/index.js';

describe('V1 API contract', () => {
  it('builds traceable success and error envelopes', () => {
    expect(
      contractOk({ id: 'o1' }, {
        code: 'ORDER_FOUND',
        message: 'ok',
        traceId: 'trace-1',
      }),
    ).toEqual({
      success: true,
      data: { id: 'o1' },
      code: 'ORDER_FOUND',
      message: 'ok',
      trace_id: 'trace-1',
    });
    expect(
      contractFail({
        code: 'ORDER_NOT_FOUND',
        message: 'missing',
        traceId: 'trace-2',
      }),
    ).toEqual({
      success: false,
      data: null,
      code: 'ORDER_NOT_FOUND',
      message: 'missing',
      trace_id: 'trace-2',
    });
  });

  it('builds empty and non-empty pagination metadata', () => {
    expect(
      buildPaginationMetadata({ page: 1, pageSize: 20, total: 0 }),
    ).toEqual({
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
      has_previous: false,
      has_next: false,
    });
    expect(
      buildPaginationMetadata({ page: 2, pageSize: 20, total: 45 }),
    ).toEqual({
      page: 2,
      page_size: 20,
      total: 45,
      total_pages: 3,
      has_previous: true,
      has_next: true,
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/shared test
```

Expected: FAIL because the V1 exports do not exist.

- [ ] **Step 3: Implement the shared primitives**

Add the exact types and helpers:

```ts
export type CanonicalId = string;
export type ExpectedVersion = number;
export type IdempotencyKey = string;

export type ApiContractMetadata<TCode extends string = string> = {
  code: TCode;
  message: string;
  trace_id: string;
};

export type ApiContractSuccess<T, TCode extends string = string> =
  ApiContractMetadata<TCode> & {
    success: true;
    data: T;
  };

export type ApiContractError<TCode extends string = string> =
  ApiContractMetadata<TCode> & {
    success: false;
    data: null;
  };

export type PaginationMetadata = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_previous: boolean;
  has_next: boolean;
};

export type PaginatedData<T> = {
  items: T[];
  pagination: PaginationMetadata;
};

type ContractOptions<TCode extends string> = {
  code: TCode;
  message: string;
  traceId: string;
};

export function contractOk<T, TCode extends string>(
  data: T,
  options: ContractOptions<TCode>,
): ApiContractSuccess<T, TCode> {
  return {
    success: true,
    data,
    code: options.code,
    message: options.message,
    trace_id: options.traceId,
  };
}

export function contractFail<TCode extends string>(
  options: ContractOptions<TCode>,
): ApiContractError<TCode> {
  return {
    success: false,
    data: null,
    code: options.code,
    message: options.message,
    trace_id: options.traceId,
  };
}

export function buildPaginationMetadata(input: {
  page: number;
  pageSize: number;
  total: number;
}): PaginationMetadata {
  const totalPages =
    input.total === 0 ? 0 : Math.ceil(input.total / input.pageSize);
  return {
    page: input.page,
    page_size: input.pageSize,
    total: input.total,
    total_pages: totalPages,
    has_previous: input.page > 1,
    has_next: input.page < totalPages,
  };
}
```

- [ ] **Step 4: Verify GREEN and regenerate shared output**

Run:

```bash
pnpm --filter @community-selection/shared test
pnpm --filter @community-selection/shared build
pnpm --filter @community-selection/shared typecheck
```

Expected: all commands pass and the local generated `dist` exposes the V1
symbols. The remote repository does not track `packages/shared/dist`, so those
build outputs are not published.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts \
  packages/shared/test/api-contract.test.ts
git commit -m "feat(shared): define V1 API contracts"
```

### Task 2: Bound and structure the order query

**Files:**

- Modify: `apps/api/src/routes/admin/order-list-query.ts`
- Modify: `apps/api/src/routes/admin/order-list-query.test.ts`

**Interfaces:**

- Produces `MAX_ADMIN_ORDER_PAGE = 10_000`.
- Changes parser errors to `{ ok: false, code, message }`.
- Preserves the successful query and Prisma where-clause shapes.

- [ ] **Step 1: Write failing parser tests**

Add assertions that page `10_000` succeeds, page `10_001` fails with
`INVALID_ADMIN_ORDER_QUERY`, and unsupported filters return the same structured
code with a field-specific message.

```ts
expect(parseAdminOrderListQuery({ page: '10000' })).toEqual({
  ok: true,
  value: { page: 10_000, page_size: 20 },
});
expect(parseAdminOrderListQuery({ page: '10001' })).toEqual({
  ok: false,
  code: 'INVALID_ADMIN_ORDER_QUERY',
  message: 'page must not exceed 10000',
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run apps/api/src/routes/admin/order-list-query.test.ts
```

Expected: FAIL because the parser accepts page `10_001` and returns a combined
error string.

- [ ] **Step 3: Implement the bound and structured error**

```ts
export const MAX_ADMIN_ORDER_PAGE = 10_000;

export type AdminOrderListQueryResult =
  | { ok: true; value: AdminOrderListQuery }
  | {
      ok: false;
      code: 'INVALID_ADMIN_ORDER_QUERY';
      message: string;
    };
```

Reject `page > MAX_ADMIN_ORDER_PAGE` after positive-integer parsing and return
the structured error from every invalid branch.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec vitest run apps/api/src/routes/admin/order-list-query.test.ts
```

Expected: parser, scope composition, masking, and page-bound tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin/order-list-query.ts \
  apps/api/src/routes/admin/order-list-query.test.ts
git commit -m "fix(api): bound Admin order pagination"
```

### Task 3: Adopt the V1 contract in the Admin order endpoint

**Files:**

- Modify: `apps/api/src/routes/admin/orders.ts`
- Modify: `apps/admin/src/features/sales/orders/types.ts`
- Modify: `apps/admin/src/features/sales/orders/api.test.ts`
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`

**Interfaces:**

- Consumes `contractOk`, `contractFail`, `buildPaginationMetadata`, and
  `PaginatedData`.
- Produces `AdminOrderListResponse = PaginatedData<AdminOrderListItem>`.
- Keeps query serialization and all mutation endpoints unchanged.

- [ ] **Step 1: Write failing Admin API and source-contract tests**

Change the API fixture to:

```ts
const response = {
  items: [{ id: 'o1' }],
  pagination: {
    page: 2,
    page_size: 50,
    total: 1,
    total_pages: 1,
    has_previous: true,
    has_next: false,
  },
};
```

Add static contract assertions requiring:

- `contractOk` and `contractFail`;
- `traceId = String(request.id)`;
- `buildPaginationMetadata`;
- the fixed error codes;
- a `try/catch` that logs the exception and returns the public 500 message.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run apps/admin/src/features/sales/orders/api.test.ts
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: FAIL because the route and page still use flat pagination and the
route still uses legacy envelopes.

- [ ] **Step 3: Implement the route contract**

For empty scope and normal results, return:

```ts
return contractOk(
  {
    items,
    pagination: buildPaginationMetadata({
      page: parsed.value.page,
      pageSize: parsed.value.page_size,
      total,
    }),
  },
  {
    code: 'ADMIN_ORDERS_LISTED',
    message: '',
    traceId: String(request.id),
  },
);
```

For parser failure, return HTTP 400 with `parsed.code`, `parsed.message`, and
the request trace. Wrap the count/find transaction in `try/catch`, log the
exception through `request.log.error`, and return HTTP 500 with
`ADMIN_ORDERS_LIST_FAILED`, `订单列表加载失败`, and the same trace.

- [ ] **Step 4: Implement the Admin pagination consumer**

Define:

```ts
export type AdminOrderListResponse =
  PaginatedData<AdminOrderListItem>;
```

Read `state.data.pagination.page`, `page_size`, and `total` in the Ant Design
table. Do not change filters, actions, details, or retained mounting.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm exec vitest run apps/admin/src/features/sales/orders/api.test.ts \
  apps/admin/src/features/sales/orders/page-model.test.ts
pnpm --filter @community-selection/admin typecheck
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: all focused tests, Admin typecheck, and the static contract pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin/orders.ts \
  apps/admin/src/features/sales/orders/types.ts \
  apps/admin/src/features/sales/orders/api.test.ts \
  apps/admin/src/features/sales/orders/OrdersPage.tsx \
  scripts/admin-e2e/contract.test.cjs
git commit -m "feat(api): adopt V1 Admin order contract"
```

### Task 4: Prove the contract in PostgreSQL and Playwright

**Files:**

- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**

- Consumes the deterministic B3 order fixture and the V1 envelope.
- Produces browser evidence for code, trace, pagination, masking, filtering,
  local failure isolation, and retry.

- [ ] **Step 1: Write the failing browser contract**

Require the smoke to assert:

```js
assert.equal(initialOrdersEnvelope.code, 'ADMIN_ORDERS_LISTED');
assert.equal(typeof initialOrdersEnvelope.trace_id, 'string');
assert.equal(typeof initialOrdersEnvelope.data.pagination.total, 'number');

const invalidOrdersEnvelope = await invalidOrdersResponse.json();
assert.equal(invalidOrdersEnvelope.code, 'INVALID_ADMIN_ORDER_QUERY');
assert.equal(typeof invalidOrdersEnvelope.trace_id, 'string');

const oversizedPageResponse = await context.request.get(
  `${baseURL}/api/admin/orders?page=10001&page_size=100`,
);
assert.equal(oversizedPageResponse.status(), 400);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: FAIL because the smoke lacks V1 and oversized-page evidence.

- [ ] **Step 3: Implement the browser assertions**

Add the exact assertions above after authentication and after the existing
invalid-filter request. Keep the existing masked-field, channel, failure
isolation, and retry evidence.

- [ ] **Step 4: Verify GREEN locally**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
node --check scripts/admin-e2e/admin-smoke.mjs
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Run the limited full gate**

Run on the single self-hosted job:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm e2e:admin
```

Expected: full lint, typecheck, tests, production builds, Admin auth runtime,
fresh PostgreSQL, Playwright, and cleanup all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/admin-e2e/admin-smoke.mjs \
  scripts/admin-e2e/contract.test.cjs
git commit -m "test(api): prove V1 Admin order contract"
```

### Task 5: Publish and review

**Files:**

- Verify all files changed since the stable base.

- [ ] **Step 1: Run final verification from final source**

Run the focused tests, shared build/typecheck, Admin typecheck, static contract,
script syntax, production build, and `git diff --check` again.

- [ ] **Step 2: Review the final diff**

Confirm there is no Prisma, migration, lockfile, miniapp, POS, device, store,
channel-write, inbox, or outbox change. Confirm the legacy shared helpers are
byte-for-byte behavior compatible.

- [ ] **Step 3: Publish**

Create `codex/l50-c1-api-contracts` from the exact stable base, publish only the
reviewed files, open a PR into `stable/l50-a3-4-business-base`, and run one
limited gate.

- [ ] **Step 4: Merge after evidence**

Merge only when the final head is mergeable, all gate steps pass, there are no
Critical or Important review findings, and the published file contents match
the locally verified source.
