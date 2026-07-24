# L50-C1.5 Orders Page Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 447-line Admin orders page into focused filter, table, detail, and orchestration components without changing observable behavior.

**Architecture:** Keep all state, effects, API calls, mutations, and parent callbacks in `OrdersPage`. Move existing JSX into three typed presentational components and protect the boundary with a source-structure contract; existing unit and Playwright coverage protect behavior.

**Tech Stack:** React 18, TypeScript 5, Ant Design 5, Vitest 2, Vite 6, Playwright

## Global Constraints

- `OrdersPage.tsx` must contain at most 200 lines.
- Do not change API paths, DTOs, Prisma, database schema, permissions, masking, business rules, copy, accessible names, or visible behavior.
- Do not add dependencies or generated `dist` artifacts.
- Do not introduce `React.lazy` or `Suspense` in this slice.
- Do not modify TaxReview, GroupBuyManagement, CatalogProducts, or Withdrawals.

---

## File map

- `OrdersPage.tsx`: state, effects, API orchestration, loading/error/refresh states.
- `OrdersFilters.tsx`: six filter fields and submit/reset controls.
- `OrdersTable.tsx`: list columns, pagination, and order action controls.
- `OrderDetailsCard.tsx`: order context summary and three log tables.
- `orders-page-structure.test.ts`: enforce the source boundary and size limit.
- `scripts/admin-e2e/contract.test.cjs`: route existing B3/C1 source assertions
  to the extracted filter and table files without weakening them.

### Task 1: Lock the structural boundary

**Files:**

- Create: `apps/admin/src/features/sales/orders/orders-page-structure.test.ts`

**Interfaces:**

- Consumes: the four order page source files.
- Produces: a failing architectural contract before component extraction.

- [ ] **Step 1: Write the failing contract**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('orders page structure', () => {
  it('keeps OrdersPage as a compact orchestrator', () => {
    const page = source('./OrdersPage.tsx');

    expect(page.split('\n').length).toBeLessThanOrEqual(200);
    expect(page).toContain("from './OrdersFilters'");
    expect(page).toContain("from './OrdersTable'");
    expect(page).toContain("from './OrderDetailsCard'");
    expect(page).not.toContain('<Form');
    expect(page).not.toContain('columns={[');
    expect(page).not.toContain('OrderTimelineLog 时间线');
  });

  it('keeps each extracted view in its own source file', () => {
    expect(source('./OrdersFilters.tsx')).toContain(
      'export function OrdersFilters',
    );
    expect(source('./OrdersTable.tsx')).toContain(
      'export function OrdersTable',
    );
    expect(source('./OrderDetailsCard.tsx')).toContain(
      'export function OrderDetailsCard',
    );
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node_modules/.bin/vitest run apps/admin/src/features/sales/orders/orders-page-structure.test.ts --maxWorkers=2 --minWorkers=1
```

Expected: FAIL because `OrdersPage.tsx` exceeds 200 lines and the three component files do not exist.

- [ ] **Step 3: Commit the RED contract**

```bash
git add apps/admin/src/features/sales/orders/orders-page-structure.test.ts
git commit -m "test(admin): lock orders page component boundaries"
```

### Task 2: Extract the filter and table views

**Files:**

- Create: `apps/admin/src/features/sales/orders/OrdersFilters.tsx`
- Create: `apps/admin/src/features/sales/orders/OrdersTable.tsx`
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`

**Interfaces:**

- `OrdersFiltersProps`: `form: FormInstance<AdminOrderFilters>`,
  `onFinish(filters): void`, `onReset(): void`.
- `OrdersTableProps`: `data: AdminOrderListResponse`,
  `onPageChange(page, pageSize): void`,
  `onLoadContext(order): void`, `onMarkOrder(order, nextStatus): void`,
  `onVerifyPickup(order): void`.

- [ ] **Step 1: Create the typed filter boundary**

```tsx
import { Button, Form, Input, Select, Space } from 'antd';
import type { FormInstance } from 'antd';
import type { AdminOrderFilters } from './page-model';

const orderTypeOptions = [
  { label: '普通购买', value: 'normal' },
  { label: '团购订单', value: 'group_buy' },
];
const pickupTypeOptions = [
  { label: '到店自提', value: 'store' },
  { label: '配送到家', value: 'delivery' },
];
const payStatusOptions = [
  { label: '未支付', value: 'unpaid' },
  { label: '已支付', value: 'paid' },
  { label: '支付失败', value: 'failed' },
  { label: '已关闭', value: 'closed' },
];
const orderStatusOptions = [
  { label: '未支付', value: 'unpaid' },
  { label: '已支付', value: 'paid' },
  { label: '已成团', value: 'grouped' },
  { label: '备货中', value: 'preparing' },
  { label: '待自提', value: 'ready' },
  { label: '已自提', value: 'picked' },
  { label: '已配送', value: 'delivered' },
  { label: '已完成', value: 'completed' },
  { label: '退款中', value: 'refunding' },
  { label: '已退款', value: 'refunded' },
  { label: '已关闭', value: 'closed' },
];
const refundStatusOptions = [
  { label: '无退款', value: 'none' },
  { label: '待处理', value: 'pending' },
  { label: '已批准', value: 'approved' },
  { label: '处理中', value: 'processing' },
  { label: '退款成功', value: 'success' },
  { label: '退款失败', value: 'failed' },
  { label: '已拒绝', value: 'rejected' },
];

export type OrdersFiltersProps = {
  form: FormInstance<AdminOrderFilters>;
  onFinish: (filters: AdminOrderFilters) => void;
  onReset: () => void;
};

export function OrdersFilters(props: OrdersFiltersProps) {
  return (
    <Form
      form={props.form}
      layout="inline"
      aria-label="全渠道订单筛选"
      onFinish={props.onFinish}
    >
      <Form.Item name="keyword">
        <Input
          aria-label="订单关键词"
          allowClear
          placeholder="订单号、收货人或手机号"
          style={{ width: 220 }}
        />
      </Form.Item>
      <Form.Item name="order_type">
        <Select
          aria-label="订单类型"
          allowClear
          placeholder="订单类型"
          options={orderTypeOptions}
          style={{ width: 130 }}
        />
      </Form.Item>
      <Form.Item name="pickup_type">
        <Select
          aria-label="履约方式"
          allowClear
          placeholder="履约方式"
          options={pickupTypeOptions}
          style={{ width: 130 }}
        />
      </Form.Item>
      <Form.Item name="pay_status">
        <Select
          aria-label="支付状态"
          allowClear
          placeholder="支付状态"
          options={payStatusOptions}
          style={{ width: 130 }}
        />
      </Form.Item>
      <Form.Item name="order_status">
        <Select
          aria-label="订单状态"
          allowClear
          placeholder="订单状态"
          options={orderStatusOptions}
          style={{ width: 130 }}
        />
      </Form.Item>
      <Form.Item name="refund_status">
        <Select
          aria-label="退款状态"
          allowClear
          placeholder="退款状态"
          options={refundStatusOptions}
          style={{ width: 130 }}
        />
      </Form.Item>
      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
          <Button onClick={props.onReset}>重置</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}
```

- [ ] **Step 2: Create the typed table boundary**

```tsx
import { Button, Space, Table } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type {
  AdminOrderListItem,
  AdminOrderListResponse,
} from './types';

export type OrdersTableProps = {
  data: AdminOrderListResponse;
  onPageChange: (page: number, pageSize: number) => void;
  onLoadContext: (order: AdminOrderListItem) => void;
  onMarkOrder: (order: AdminOrderListItem, nextStatus: string) => void;
  onVerifyPickup: (order: AdminOrderListItem) => void;
};

export function OrdersTable(props: OrdersTableProps) {
  return (
    <Table
      rowKey="id"
      dataSource={props.data.items}
      pagination={{
        current: props.data.pagination.page,
        pageSize: props.data.pagination.page_size,
        total: props.data.pagination.total,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 条`,
        onChange: props.onPageChange,
      }}
      scroll={{ x: 1800 }}
      columns={[
        { title: '订单号', dataIndex: 'order_no', fixed: 'left' },
        {
          title: '渠道',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.channel.label,
        },
        {
          title: '订单类型',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.order_type === 'group_buy' ? '团购订单' : '普通购买',
        },
        {
          title: '商品',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.product?.name ?? '-',
        },
        {
          title: '用户',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.user.nickname,
        },
        {
          title: '履约方式',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.pickup_type === 'delivery' ? '配送到家' : '到店自提',
        },
        {
          title: '社区 / 自提点',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.community?.name ?? order.pickup_store?.name ?? '-',
        },
        {
          title: '金额',
          render: (_: unknown, order: AdminOrderListItem) =>
            `¥${formatYuan(order.pay_amount_cents)}`,
        },
        { title: '支付状态', dataIndex: 'pay_status' },
        { title: '订单状态', dataIndex: 'order_status' },
        { title: '退款状态', dataIndex: 'refund_status' },
        {
          title: '收货信息',
          render: (_: unknown, order: AdminOrderListItem) =>
            [
              order.receiver_name,
              order.receiver_phone_masked,
              order.receiver_address_masked,
            ]
              .filter(Boolean)
              .join(' / '),
        },
        {
          title: '操作',
          fixed: 'right',
          render: (_: unknown, order: AdminOrderListItem) => (
            <Space wrap>
              <Button onClick={() => props.onLoadContext(order)}>详情</Button>
              <Button
                onClick={() => props.onMarkOrder(order, 'preparing')}
              >
                备货中
              </Button>
              <Button onClick={() => props.onMarkOrder(order, 'ready')}>
                待自提
              </Button>
              <Button onClick={() => props.onVerifyPickup(order)}>
                核销自提
              </Button>
              <Button onClick={() => props.onMarkOrder(order, 'picked')}>
                已自提
              </Button>
              <Button
                onClick={() => props.onMarkOrder(order, 'completed')}
              >
                完成
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}
```

- [ ] **Step 3: Wire both views from the page**

```tsx
<OrdersFilters
  form={form}
  onFinish={applyFilters}
  onReset={resetFilters}
/>
<OrdersTable
  data={state.data}
  onPageChange={(page, pageSize) =>
    setQuery((current) => changeOrderPage(current, page, pageSize))
  }
  onLoadContext={loadOrderContext}
  onMarkOrder={markOrder}
  onVerifyPickup={pickupVerify}
/>
```

- [ ] **Step 4: Run focused TypeScript and tests**

Run:

```bash
node_modules/.bin/vitest run \
  apps/admin/src/features/sales/orders/orders-page-structure.test.ts \
  apps/admin/src/features/sales/orders/page-model.test.ts \
  apps/admin/src/features/sales/orders/api.test.ts \
  --maxWorkers=2 --minWorkers=1
node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
```

Expected: the structure contract remains RED only because the detail view is
not yet extracted; existing five order tests and TypeScript pass.

### Task 3: Extract the detail view and reach GREEN

**Files:**

- Create: `apps/admin/src/features/sales/orders/OrderDetailsCard.tsx`
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`

**Interfaces:**

- `OrderDetailsCardProps`: `context: AiContext`.

- [ ] **Step 1: Create the typed details boundary**

```tsx
import { Card, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { AiContext } from './types';

export type OrderDetailsCardProps = {
  context: AiContext;
};

export function OrderDetailsCard({ context }: OrderDetailsCardProps) {
  return (
    <Card title="订单全链路详情">
      <Typography.Title level={4}>订单基础信息</Typography.Title>
      <Typography.Paragraph>
        订单号：{context.order.order_no}；状态：
        {context.order.order_status}；支付状态：
        {context.order.pay_status}；实付：¥
        {formatYuan(context.order.pay_amount_cents)}
      </Typography.Paragraph>
      <Typography.Paragraph>
        消费额度抵扣：¥
        {formatYuan(context.credit_usage?.amount_cents ?? 0)}
        ；来源：
        {context.credit_usage?.from_reward_conversion
          ? '开团服务奖励转平台消费额度'
          : '-'}
      </Typography.Paragraph>
      <Typography.Title level={4}>
        支付 / 退款 / 开团服务奖励 / 提现或转消费额度信息
      </Typography.Title>
      <Typography.Paragraph>
        支付、退款、开团服务奖励与提现或转消费额度信息通过下方
        BusinessEventLog、OpsAlertLog 与 AI context 汇总展示。
      </Typography.Paragraph>
      <Typography.Title level={4}>
        OrderTimelineLog 时间线
      </Typography.Title>
      <Table
        rowKey="id"
        dataSource={context.timeline}
        pagination={false}
        columns={[
          { title: '事件', dataIndex: 'event_type' },
          { title: '标题', dataIndex: 'title' },
          { title: '时间', dataIndex: 'created_at' },
        ]}
      />
      <Typography.Title level={4}>BusinessEventLog</Typography.Title>
      <Table
        rowKey="id"
        dataSource={context.business_events}
        pagination={false}
        columns={[
          { title: '事件', dataIndex: 'event_type' },
          { title: '级别', dataIndex: 'event_level' },
          { title: '说明', dataIndex: 'message' },
        ]}
      />
      <Typography.Title level={4}>OpsAlertLog</Typography.Title>
      <Table
        rowKey="id"
        dataSource={context.alerts}
        pagination={false}
        columns={[
          { title: '类型', dataIndex: 'alert_type' },
          { title: '级别', dataIndex: 'alert_level' },
          { title: '状态', dataIndex: 'status' },
          { title: '标题', dataIndex: 'title' },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 2: Wire the details boundary**

```tsx
{selectedOrderContext ? (
  <OrderDetailsCard context={selectedOrderContext} />
) : null}
```

- [ ] **Step 3: Verify GREEN**

Run:

```bash
node_modules/.bin/vitest run \
  apps/admin/src/features/sales/orders/orders-page-structure.test.ts \
  apps/admin/src/features/sales/orders/page-model.test.ts \
  apps/admin/src/features/sales/orders/api.test.ts \
  --maxWorkers=2 --minWorkers=1
node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
wc -l apps/admin/src/features/sales/orders/OrdersPage.tsx
```

Expected: 7/7 tests pass, TypeScript exits 0, and `OrdersPage.tsx` is at most
200 lines.

- [ ] **Step 4: Commit the component extraction**

```bash
git add \
  apps/admin/src/features/sales/orders/OrdersPage.tsx \
  apps/admin/src/features/sales/orders/OrdersFilters.tsx \
  apps/admin/src/features/sales/orders/OrdersTable.tsx \
  apps/admin/src/features/sales/orders/OrderDetailsCard.tsx
git commit -m "refactor(admin): split orders page views"
```

### Task 4: Full verification and delivery

**Files:**

- Verify all files changed since `stable/l50-a3-4-business-base`.
- Modify: `scripts/admin-e2e/contract.test.cjs`

- [ ] **Step 1: Route the existing B3/C1 source evidence**

Read `OrdersFilters.tsx` when asserting the standard Ant Design submit path,
and read `OrdersTable.tsx` when asserting the nested C1 pagination contract.
Keep the existing negative assertion against `form.getFieldsValue()` across
both the orchestrator and filter source.

- [ ] **Step 2: Run the complete local gate**

```bash
node_modules/.bin/vitest run apps/admin/src --maxWorkers=2 --minWorkers=1
node_modules/.bin/tsc -p apps/admin/tsconfig.json --noEmit
(cd apps/admin && node_modules/.bin/vite build)
node --test scripts/admin-e2e/contract.test.cjs
git diff --check
```

Expected: all Admin tests pass, TypeScript and Vite exit 0, and diff check has
no output.

- [ ] **Step 3: Review scope**

```bash
git diff --stat codex/l50-c1-api-contracts...HEAD
git diff --name-only codex/l50-c1-api-contracts...HEAD
```

Expected: only the order feature’s four components, structure contract,
global Admin E2E contract routing, and the C1.5 spec/plan are present.

- [ ] **Step 4: Publish and run the remote gate**

Create a branch from `stable/l50-a3-4-business-base`, publish the verified
files byte-for-byte, open a PR, and use the same single-job resource limits as
L50-C1. The remote gate must run full workspace typecheck/test/build plus the
existing authenticated PostgreSQL + Playwright Admin order flow.

- [ ] **Step 5: Merge only after final-head verification**

Delete any temporary workflow, confirm the final delivery diff, confirm no
Critical/Important review findings, re-read the exact PR head SHA, and merge
with that SHA as the concurrency guard.
