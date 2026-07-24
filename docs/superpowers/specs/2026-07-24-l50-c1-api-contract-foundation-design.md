# L50-C1 Unified API Contract Foundation Design

## Goal

Establish one versioned, reusable Admin API contract on
`GET /api/admin/orders` without a database migration or a behavior change in
the Admin order workbench.

## Scope

L50-C1 includes:

- a shared V1 success/error envelope with required `code`, `message`, and
  `trace_id`;
- shared types for canonical IDs, optimistic versions, idempotency keys, and
  paginated data;
- one canonical list shape: `items` plus a nested `pagination` object;
- a hard order-list page ceiling of `10,000` and page-size ceiling of `100`;
- structured validation errors from the order query parser;
- safe order-list internal-error handling that does not expose database
  details;
- Admin, API model, static contract, and PostgreSQL/Playwright evidence.

L50-C1 does not include:

- Prisma schema changes or migrations;
- `expected_version` enforcement on write endpoints;
- idempotency persistence or replay;
- POS, device, store, channel-write, inbox, or outbox models;
- migration of unrelated endpoints to the V1 contract.

## Contract

Successful V1 responses use:

```ts
type ApiContractSuccess<T> = {
  success: true;
  data: T;
  code: string;
  message: string;
  trace_id: string;
};
```

Failed V1 responses use:

```ts
type ApiContractError = {
  success: false;
  data: null;
  code: string;
  message: string;
  trace_id: string;
};
```

The Admin order list data is:

```ts
type PaginatedData<T> = {
  items: T[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    has_previous: boolean;
    has_next: boolean;
  };
};
```

The endpoint codes are:

- `ADMIN_ORDERS_LISTED` for a successful list response;
- `INVALID_ADMIN_ORDER_QUERY` for an unsupported or unsafe query;
- `ADMIN_ORDERS_LIST_FAILED` for an unexpected list failure.

`trace_id` is the Fastify request ID converted to a string. Internal exceptions
are logged with that request context, while the response contains only the
stable public message `订单列表加载失败`.

## Pagination Safety

`page` must be a positive integer no greater than `10,000`.
`page_size` must be a positive integer and is capped at `100`.
Therefore the largest Prisma offset produced by this endpoint is `999,900`.
A request above the page ceiling is rejected with HTTP 400 before Prisma is
called.

The response calculates `total_pages` from the real count. An empty result has
`total_pages: 0`, `has_previous` reflects the requested page, and `has_next`
is true only when the requested page is below `total_pages`.

## Compatibility

The existing legacy `ok` and `fail` helpers stay unchanged so unrelated routes
do not change during C1. The Admin order workbench changes only how it reads
pagination metadata; filtering, refresh, retry, details, status updates,
pickup verification, and exports remain unchanged.

The Admin workspace ambient declaration must expose the same C1 public
contract types and helpers as `@community-selection/shared`; otherwise it
shadows the package declaration during the complete workspace typecheck.

The public aliases `CanonicalId`, `ExpectedVersion`, and `IdempotencyKey`
define C2's type boundary only. No runtime write semantics are introduced in
C1.

## Verification

Verification must prove:

- contract constructors emit required metadata;
- pagination metadata is correct for empty, first, middle, and final pages;
- page `10,000` is accepted and page `10,001` is rejected;
- invalid filters return HTTP 400 with code and trace ID;
- authenticated success returns the nested pagination contract;
- the order DTO remains masked and data-scoped;
- the Admin page still filters, paginates, isolates failures, and retries;
- full typecheck, tests, build, PostgreSQL, and Playwright pass under the
  existing limited-runner policy.

## Immediate Follow-up: L50-C1.5 Oversized Admin Pages

L50-C1.5 starts immediately after C1 merges. It is a behavior-preserving
frontend maintainability slice, separate from the API contract.

The first target is the roughly 453-line `OrdersPage.tsx`. It will be split
into order filters, order table/actions, and order details components, with
the orchestration page reduced to about 200 lines or fewer. The next targets,
in descending current size, are tax review, group-buy management, catalog
products, and withdrawals. Each split must preserve the rendered interface,
request isolation, retained state, and existing PostgreSQL/Playwright evidence.
