# L50-B3 Omnichannel Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Admin client's public full-order load with a secure, paginated `/api/admin/orders` view that exposes the existing order core as one read-only channel-neutral workbench.

**Architecture:** Extend the existing protected Admin order route with a pure query/parser layer, Prisma-side filtering and data-scope composition, and a masked list DTO. The Admin order slice consumes that DTO through its existing isolated resource lifecycle while keeping existing detail, status, pickup-verification, export, navigation, refresh, and error-boundary behavior.

**Tech Stack:** TypeScript, Fastify 5, Prisma 6/PostgreSQL, React 18, Ant Design 5, Vitest 2, Node test runner, Playwright.

## Global Constraints

- Base branch is `stable/l50-a3-4-business-base` after merged L50-B2.
- Add no Prisma schema or migration.
- Add no dependency or lockfile change.
- Existing records are presented as channel code `wechat_miniapp`, label `微信小程序`, source `historical_default`.
- Channel metadata is read-only presentation; it is not persisted and does not imply another channel is integrated.
- Enforce `order.view`, active AdminUser checks, and existing pickup-store/community data scope.
- Return only masked receiver phone and address fields from the list route.
- Preserve existing order detail, status update, pickup verification, and picking-export behavior.
- Preserve all 23 Admin pages, B1 grouped navigation, and B2 role workbench.
- Do not add POS, device, store model, channel write path, synchronization, or external connector behavior.
- Runner limits remain workspace concurrency 1, Vitest threads 1–2, and Node heap 3 GiB.

---

### Task 1: Protected Admin Order List Contract

**Files:**
- Create: `apps/api/src/routes/admin/order-list-query.ts`
- Create: `apps/api/src/routes/admin/order-list-query.test.ts`
- Modify: `apps/api/src/routes/admin/orders.ts`

**Interfaces:**
- Consumes: `AdminAccessContext`, `getScopedOrderWhere(context)`, and the existing Prisma `Order` relations.
- Produces: `parseAdminOrderListQuery(input)`, `buildAdminOrderListWhere(query, scopeWhere)`, and `toAdminOrderListItem(order)`.

- [ ] **Step 1: Write failing parser and projection tests**

```ts
it('normalizes bounded pagination and supported filters', () => {
  expect(parseAdminOrderListQuery({
    keyword: '  WX-100  ',
    order_type: 'group_buy',
    pickup_type: 'delivery',
    pay_status: 'paid',
    order_status: 'preparing',
    refund_status: 'pending',
    page: '2',
    page_size: '200',
  })).toEqual({
    ok: true,
    value: {
      keyword: 'WX-100',
      order_type: 'group_buy',
      pickup_type: 'delivery',
      pay_status: 'paid',
      order_status: 'preparing',
      refund_status: 'pending',
      page: 2,
      page_size: 100,
    },
  });
});

it('projects one masked historical WeChat order item', () => {
  expect(toAdminOrderListItem(orderFixture)).toMatchObject({
    channel: {
      code: 'wechat_miniapp',
      label: '微信小程序',
      source: 'historical_default',
    },
    receiver_phone_masked: '138****8000',
    receiver_address_masked: '南京市玄武区***',
  });
  expect(toAdminOrderListItem(orderFixture)).not.toHaveProperty('receiver_phone');
  expect(toAdminOrderListItem(orderFixture)).not.toHaveProperty('receiver_address');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run apps/api/src/routes/admin/order-list-query.test.ts
```

Expected: FAIL because `order-list-query.ts` does not exist.

- [ ] **Step 3: Implement the pure list-query module**

```ts
export type AdminOrderListQuery = {
  keyword?: string;
  order_type?: 'normal' | 'group_buy';
  pickup_type?: 'store' | 'delivery';
  pay_status?: 'unpaid' | 'paid' | 'failed' | 'closed';
  order_status?: string;
  refund_status?: string;
  page: number;
  page_size: number;
};

export function buildAdminOrderListWhere(
  query: AdminOrderListQuery,
  scopeWhere: Record<string, unknown>,
): Record<string, unknown> {
  const filters: Record<string, unknown>[] = [scopeWhere];
  if (query.order_type === 'group_buy') filters.push({ group_buy_id: { not: null } });
  if (query.order_type === 'normal') filters.push({ group_buy_id: null });
  if (query.pickup_type) filters.push({ pickup_type: query.pickup_type });
  if (query.pay_status) filters.push({ pay_status: query.pay_status });
  if (query.order_status) filters.push({ order_status: query.order_status });
  if (query.refund_status) filters.push({ refund_status: query.refund_status });
  if (query.keyword) {
    filters.push({
      OR: [
        { order_no: { contains: query.keyword, mode: 'insensitive' } },
        { receiver_name: { contains: query.keyword, mode: 'insensitive' } },
        { receiver_phone: { contains: query.keyword } },
      ],
    });
  }
  return { AND: filters };
}
```

The implementation must also validate allow-listed enum values, default `page=1` and `page_size=20`, cap `page_size` at 100, and expose only masked receiver fields.

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run:

```bash
pnpm exec vitest run apps/api/src/routes/admin/order-list-query.test.ts
```

Expected: all parser, scope-composition, filter, deterministic pagination, channel, and masking tests pass.

- [ ] **Step 5: Add the protected list route**

```ts
app.get(
  '/api/admin/orders',
  { preHandler: requireAdminPermission('order.view') },
  async (request, reply) => {
    const context = resolveAdminAccessContext(request);
    if (!context) {
      reply.code(401);
      return fail('ADMIN_UNAUTHORIZED: Admin identity required');
    }
    const parsed = parseAdminOrderListQuery(request.query as Record<string, unknown>);
    if (!parsed.ok) {
      reply.code(400);
      return fail(parsed.error);
    }
    const scopeWhere = getScopedOrderWhere(context);
    if (!scopeWhere) {
      return ok({ total: 0, page: parsed.value.page, page_size: parsed.value.page_size, items: [] });
    }
    const where = buildAdminOrderListWhere(parsed.value, scopeWhere);
    const [total, items] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true } },
          product: true,
          group_buy: { include: { product: true, community: true } },
          pickup_store: true,
          community: true,
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (parsed.value.page - 1) * parsed.value.page_size,
        take: parsed.value.page_size,
      }),
    ]);
    return ok({
      total,
      page: parsed.value.page,
      page_size: parsed.value.page_size,
      items: items.map(toAdminOrderListItem),
    });
  },
);
```

- [ ] **Step 6: Run API type and test gates available in the complete repository**

Run:

```bash
pnpm --filter @community-selection/api typecheck
pnpm --filter @community-selection/api test
```

Expected: API typecheck and all API tests pass. The local sparse worktree may run only the pure test; the complete commands are mandatory on the Runner.

- [ ] **Step 7: Commit the API slice**

```bash
git add apps/api/src/routes/admin/order-list-query.ts \
  apps/api/src/routes/admin/order-list-query.test.ts \
  apps/api/src/routes/admin/orders.ts
git commit -m "feat(api): add scoped Admin order list"
```

### Task 2: Typed Admin Order Query Client

**Files:**
- Modify: `apps/admin/src/features/sales/orders/types.ts`
- Modify: `apps/admin/src/features/sales/orders/api.ts`
- Modify: `apps/admin/src/features/sales/orders/api.test.ts`

**Interfaces:**
- Consumes: `JsonRequester` and `/api/admin/orders`.
- Produces: `AdminOrderListQuery`, `AdminOrderListItem`, `AdminOrderListResponse`, and `loadOrders(query, request, signal)`.

- [ ] **Step 1: Change the API test first**

```ts
await loadOrders(
  {
    keyword: 'WX-100',
    order_type: 'group_buy',
    pickup_type: 'delivery',
    page: 2,
    page_size: 50,
  },
  request,
);

expect(request).toHaveBeenCalledWith(
  '/api/admin/orders?keyword=WX-100&order_type=group_buy&pickup_type=delivery&page=2&page_size=50',
  { signal: undefined },
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/sales/orders/api.test.ts
```

Expected: FAIL because `loadOrders` still calls `/api/orders` and returns `Order[]`.

- [ ] **Step 3: Add DTOs and deterministic query serialization**

```ts
export type AdminOrderListResponse = {
  total: number;
  page: number;
  page_size: number;
  items: AdminOrderListItem[];
};

export function loadOrders(
  query: AdminOrderListQuery,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<AdminOrderListResponse> {
  const search = buildAdminOrderListSearch(query);
  return request<AdminOrderListResponse>(
    `/api/admin/orders${search ? `?${search}` : ''}`,
    { signal },
  );
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/sales/orders/api.test.ts
```

Expected: all order API boundary tests pass; existing action URLs remain unchanged.

- [ ] **Step 5: Commit the client slice**

```bash
git add apps/admin/src/features/sales/orders/types.ts \
  apps/admin/src/features/sales/orders/api.ts \
  apps/admin/src/features/sales/orders/api.test.ts
git commit -m "feat(admin): query scoped order list"
```

### Task 3: Unified Order Workbench UI

**Files:**
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`
- Create: `apps/admin/src/features/sales/orders/page-model.ts`
- Create: `apps/admin/src/features/sales/orders/page-model.test.ts`

**Interfaces:**
- Consumes: `loadOrders(query)`, `AdminOrderListResponse`, existing detail and mutation actions.
- Produces: an accessible filter form, masked order table, controlled server pagination, and unchanged action handlers.

- [ ] **Step 1: Write failing page-model tests**

```ts
it('resets the page when filters are applied', () => {
  expect(applyOrderFilters(
    { page: 4, page_size: 20 },
    { keyword: 'WX-100', order_type: 'group_buy' },
  )).toEqual({
    page: 1,
    page_size: 20,
    keyword: 'WX-100',
    order_type: 'group_buy',
  });
});

it('keeps filters when only pagination changes', () => {
  expect(changeOrderPage(
    { page: 1, page_size: 20, refund_status: 'pending' },
    3,
    50,
  )).toEqual({
    page: 3,
    page_size: 50,
    refund_status: 'pending',
  });
});
```

- [ ] **Step 2: Run the page-model test and verify RED**

Run:

```bash
pnpm --filter @community-selection/admin test -- src/features/sales/orders/page-model.test.ts
```

Expected: FAIL because `page-model.ts` does not exist.

- [ ] **Step 3: Implement the model and update the page**

The page must:

```tsx
<Card title="全渠道订单">
  <Form aria-label="全渠道订单筛选">
    <Input aria-label="订单关键词" />
    <Select aria-label="订单类型" />
    <Select aria-label="履约方式" />
    <Select aria-label="支付状态" />
    <Select aria-label="订单状态" />
    <Select aria-label="退款状态" />
    <Button htmlType="submit">查询</Button>
    <Button>重置</Button>
  </Form>
  <Table
    rowKey="id"
    dataSource={state.data.items}
    pagination={{
      current: state.data.page,
      pageSize: state.data.page_size,
      total: state.data.total,
    }}
  />
</Card>
```

The table must show channel, order type, fulfillment, community/pickup store, amount, payment/order/refund states, masked receiver fields, and existing actions. Filter or page changes request the server; Shell refresh and local retry retain the applied query.

- [ ] **Step 4: Run focused and full Admin verification**

Run:

```bash
pnpm --filter @community-selection/admin test
pnpm --filter @community-selection/admin typecheck
```

Expected: all Admin tests and strict TypeScript pass.

- [ ] **Step 5: Commit the workbench slice**

```bash
git add apps/admin/src/features/sales/orders/OrdersPage.tsx \
  apps/admin/src/features/sales/orders/page-model.ts \
  apps/admin/src/features/sales/orders/page-model.test.ts
git commit -m "feat(admin): add unified order workbench"
```

### Task 4: Real Browser and Regression Evidence

**Files:**
- Modify: `scripts/admin-e2e/admin-smoke.mjs`
- Modify: `scripts/admin-e2e/contract.test.cjs`

**Interfaces:**
- Consumes: the authenticated Admin shell, real PostgreSQL API, and `/api/admin/orders`.
- Produces: source contracts and Playwright evidence for the B3 workbench plus all prior B1/B2/A3 behavior.

- [ ] **Step 1: Add B3 contract expectations first**

```js
assert.match(smoke, /pathname === '\\/api\\/admin\\/orders'/);
assert.match(smoke, /getByRole\\('form', \\{ name: '全渠道订单筛选' \\}\\)/);
assert.match(smoke, /getByLabel\\('订单关键词'\\)\\.fill\\(/);
assert.match(smoke, /getByRole\\('columnheader', \\{ name: '渠道' \\}\\)/);
assert.match(smoke, /orderEnvelope\\.data\\.items/);
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
```

Expected: the new B3 contract fails because the smoke still targets `/api/orders` and has no filter/pagination proof.

- [ ] **Step 3: Update the real browser flow**

The smoke must:

```js
const ordersPath = '/api/admin/orders';
const orderFilter = page.getByRole('form', { name: '全渠道订单筛选' });
const firstOrderNo = initialOrdersEnvelope.data.items[0].order_no;
await orderFilter.getByLabel('订单关键词').fill(firstOrderNo);
const filteredResponse = page.waitForResponse((response) =>
  new URL(response.url()).pathname === ordersPath && response.ok(),
);
await orderFilter.getByRole('button', { name: '查询', exact: true }).click();
const filteredEnvelope = await (await filteredResponse).json();
assert.equal(filteredEnvelope.success, true);
assert.equal(Array.isArray(filteredEnvelope.data.items), true);
await page.getByRole('columnheader', { name: '渠道' }).waitFor();
await page.getByText('微信小程序', { exact: true }).first().waitFor();
```

Move the existing one-shot failure, retry, response-envelope, exact counter, and unroute evidence from `**/api/orders` to `**/api/admin/orders*`. Keep the public status-action route assertions unchanged.

- [ ] **Step 4: Run source contracts and syntax verification**

Run:

```bash
node --test scripts/admin-e2e/contract.test.cjs
node --check scripts/admin-e2e/admin-smoke.mjs
```

Expected: all contracts pass and smoke syntax is valid.

- [ ] **Step 5: Run the complete limited gate**

Run:

```bash
NODE_OPTIONS=--max-old-space-size=3072 \
VITEST_MIN_THREADS=1 \
VITEST_MAX_THREADS=2 \
pnpm --workspace-concurrency=1 lint

NODE_OPTIONS=--max-old-space-size=3072 \
VITEST_MIN_THREADS=1 \
VITEST_MAX_THREADS=2 \
pnpm --workspace-concurrency=1 typecheck

NODE_OPTIONS=--max-old-space-size=3072 \
VITEST_MIN_THREADS=1 \
VITEST_MAX_THREADS=2 \
pnpm --workspace-concurrency=1 test

NODE_OPTIONS=--max-old-space-size=3072 pnpm build
```

Expected: lint, serial typecheck, serial tests, and production build pass.

- [ ] **Step 6: Commit browser evidence**

```bash
git add scripts/admin-e2e/admin-smoke.mjs \
  scripts/admin-e2e/contract.test.cjs
git commit -m "test(admin): prove L50-B3 order workbench"
```

### Task 5: Publish, Limit-Gate, Review, and Merge

**Files:**
- Create temporarily on the PR branch: `.github/workflows/l50-b3-admin-gate.yml`
- Delete before merge: `.github/workflows/l50-b3-admin-gate.yml`

**Interfaces:**
- Consumes: the exact verified B3 branch head.
- Produces: one PR, one serial self-hosted gate, a clean final diff, review evidence, and a guarded merge.

- [ ] **Step 1: Verify final local candidate**

Run:

```bash
git diff --check
git status --short
git diff --stat <base-sha>...HEAD
```

Expected: only plan, API order list, Admin order slice, and Admin E2E files are changed.

- [ ] **Step 2: Publish one branch and create one PR**

The PR must target `stable/l50-a3-4-business-base`, state that channel is historical read-only metadata, and list the no-migration/no-POS boundary.

- [ ] **Step 3: Run one limited self-hosted workflow**

The single serial job must run locked install, Prisma generation, B3 focused tests, lint, typecheck, all tests, build, Admin auth runtime, PostgreSQL plus Playwright, and unconditional exact-resource cleanup. It must use:

```yaml
env:
  NODE_OPTIONS: --max-old-space-size=3072
  VITEST_MIN_THREADS: "1"
  VITEST_MAX_THREADS: "2"
```

Workspace typecheck/test commands must set `--workspace-concurrency=1`; `concurrency.cancel-in-progress` must prevent duplicate heavy runs.

- [ ] **Step 4: Remove the temporary workflow and re-read remote state**

After a successful terminal Run, delete the temporary workflow, then re-read the remote PR head, compare list, behind count, mergeability, and exact file hashes. Do not rely on the pre-deletion SHA.

- [ ] **Step 5: Review the complete diff**

Confirm:

- no unauthorized or unscoped list access;
- no full phone/address returned;
- no client-side full-dataset pagination;
- no channel persistence claim;
- no broken detail/status/pickup/export behavior;
- no B1/B2/23-page regression;
- no API/schema/dependency change outside the approved files.

- [ ] **Step 6: Merge with exact-head protection**

Merge only if the Runner is successful, cleanup is successful, review has no Critical/Important findings, final diff is scoped, branch is not behind, and the merge call uses the final remote head SHA.
