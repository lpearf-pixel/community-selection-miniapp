# L50-A1 Admin Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在不改变现有后台 endpoint、业务动作、页面文案和依赖版本的前提下，建立统一请求客户端、稳定页面标识、feature registry、AdminShell 和页面级错误隔离，为 L50 后续按领域拆分后台提供可测试基础。

**Architecture:** 本阶段只建立管理端内部边界。现有 App 页面内容和业务请求保持原行为；稳定的 ViewKey、导航元数据和请求错误类型从 App.tsx 移出，AdminShell 只负责会话、导航与全局动作，AdminErrorBoundary 只隔离当前工作区。后续阶段可逐页迁移，不要求本阶段修改 Prisma、API 路由或数据库。

**Tech Stack:** React 18.3.1、React DOM 18.3.1、Ant Design 5.23.0、TypeScript strict、Vitest 2.1.8、Vite 6、pnpm 9.15.4。

## Global Constraints

- 基线分支为 **stable/l49-business-base**；实现分支命名为 **codex/l50-a1-admin-foundation**。
- React 固定 18.3.1，React DOM 固定 18.3.1，Ant Design 固定 5.23.0。
- pnpm 固定 9.15.4；不新增运行时或测试依赖。
- TypeScript 保持 strict 与 noImplicitAny。
- Fastify、Prisma、PostgreSQL、API endpoint、响应 envelope 和认证 cookie 行为不变。
- 不修改 **prisma/schema.prisma**、任何 migration、锁文件或生产数据。
- 金额继续使用整数分；库存和称重数量语义不在本阶段调整。
- 本阶段不启用真实 POS 写入、不调用银豹、不实现 outbox/inbox、不拆微服务。
- 导航元数据不替代服务端授权；permission 字段在本阶段只作为声明，不用于隐藏页面。
- 每个任务使用 TDD，提交前运行该任务的聚焦测试；最终运行完整管理端 test、typecheck 和 build。

---

## Delivery Map

| 子阶段 | 独立交付物 | 进入条件 |
|---|---|---|
| L50-A1 | 请求、页面标识、registry、shell、错误隔离 | 本计划通过 |
| L50-A2 | 将页面 API 逐个迁移到统一 client，并拆除全局 Promise.all 刷新 | A1 合并且真实后台 smoke 通过 |
| L50-A3 | 按 catalog、sales、inventory、finance、operations、system 抽离 feature 页面与局部状态 | A2 合并且 endpoint 合同未漂移 |
| L50-B | 新信息架构、角色工作台、全渠道只读视图 | A3 合并且导航/权限矩阵通过 |
| L50-C | 规范 DTO、分页、版本、幂等与数据 owner | B 合并，单独批准 schema/migration 计划 |
| L50-D | outbox/inbox、mapping、cursor、dead letter、fake connector | C 合并且同步契约获批 |
| L50-E | 多副本、worker lease、可观测性、备份恢复与 #85/#87 门禁 | D 合并且压测环境隔离完成 |

每个子阶段从当时最新 stable 创建分支并独立 PR。不得把 A1 至 E 压入同一个提交链。

## File Responsibility Map

| Path | Responsibility |
|---|---|
| **apps/admin/src/app/admin-view.ts** | 唯一的后台页面 key、默认页面和类型 |
| **apps/admin/src/app/admin-view.test.ts** | 锁定现有 24 个页面 key，防止无意删除或重命名 |
| **apps/admin/src/shared/api/errors.ts** | 稳定的 HTTP/业务错误类型 |
| **apps/admin/src/shared/api/request-context.ts** | correlation、idempotency、timeout、cancel 上下文 |
| **apps/admin/src/shared/api/client.ts** | 可注入 fetch/header provider 的 JSON 请求器 |
| **apps/admin/src/shared/api/client.test.ts** | 成功、错误、header、取消和超时合同 |
| **apps/admin/src/app/feature-registry.ts** | 现有页面到领域、文案、权限声明的唯一映射 |
| **apps/admin/src/app/feature-registry.test.ts** | 唯一性、完整性、默认页和 login 排除测试 |
| **apps/admin/src/app/navigation.ts** | 从 registry 生成当前导航项的纯函数 |
| **apps/admin/src/app/navigation.test.ts** | 锁定现有导航顺序、标签和选择行为 |
| **apps/admin/src/app/AdminErrorBoundary.tsx** | 当前工作区的 React 错误隔离与重试入口 |
| **apps/admin/src/app/AdminShell.tsx** | 管理端标题、管理员信息、导航、刷新和退出 |
| **apps/admin/src/app/AdminApp.tsx** | 会话与当前 view 编排；暂时承载原 App 业务工作区 |
| **apps/admin/src/App.tsx** | 兼容入口，只导出 AdminApp 为 App |
| **apps/admin/src/api/adminRequest.ts** | 兼容已有 API 模块，内部委托统一 client |
| **apps/admin/src/main.tsx** | 保持现有 createRoot 和 StrictMode，不改变启动协议 |

---

### Task 1: Lock the Current Admin View Contract

**Files:**
- Create: **apps/admin/src/app/admin-view.ts**
- Create: **apps/admin/src/app/admin-view.test.ts**
- Modify: **apps/admin/src/App.tsx**

**Interfaces:**
- Produces: **ADMIN_VIEW_KEYS**, **AdminViewKey**, **DEFAULT_ADMIN_VIEW**
- Consumes: none

- [ ] **Step 1: Write the failing view-contract test**

~~~ts
import { describe, expect, it } from 'vitest';
import {
  ADMIN_VIEW_KEYS,
  DEFAULT_ADMIN_VIEW,
  type AdminViewKey,
} from './admin-view';

describe('admin view contract', () => {
  it('keeps every L49 view key exactly once', () => {
    expect(ADMIN_VIEW_KEYS).toEqual([
      'login',
      'products',
      'groupBuys',
      'failedGroupBuyClosure',
      'orders',
      'fulfillment',
      'inventory',
      'purchasePlans',
      'suppliers',
      'batches',
      'expiryAlerts',
      'stockChecks',
      'afterSales',
      'withdrawals',
      'alerts',
      'taxRecords',
      'finance',
      'refundLedger',
      'rewardLedger',
      'operations',
      'pickupWorkbench',
      'deliveryReservation',
      'deliveryRuleConfig',
      'dashboardV2',
    ]);
    expect(new Set(ADMIN_VIEW_KEYS).size).toBe(ADMIN_VIEW_KEYS.length);
  });

  it('uses products as the authenticated landing view', () => {
    const landing: AdminViewKey = DEFAULT_ADMIN_VIEW;
    expect(landing).toBe('products');
  });
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/admin-view.test.ts
~~~

Expected: FAIL because **admin-view.ts** does not exist.

- [ ] **Step 3: Implement the stable view contract**

~~~ts
export const ADMIN_VIEW_KEYS = [
  'login',
  'products',
  'groupBuys',
  'failedGroupBuyClosure',
  'orders',
  'fulfillment',
  'inventory',
  'purchasePlans',
  'suppliers',
  'batches',
  'expiryAlerts',
  'stockChecks',
  'afterSales',
  'withdrawals',
  'alerts',
  'taxRecords',
  'finance',
  'refundLedger',
  'rewardLedger',
  'operations',
  'pickupWorkbench',
  'deliveryReservation',
  'deliveryRuleConfig',
  'dashboardV2',
] as const;

export type AdminViewKey = (typeof ADMIN_VIEW_KEYS)[number];

export const DEFAULT_ADMIN_VIEW: AdminViewKey = 'products';
~~~

Modify **App.tsx** to import **AdminViewKey** and **DEFAULT_ADMIN_VIEW**, remove its local ViewKey union, type the state as **AdminViewKey**, and replace both authenticated **setView('products')** calls with **setView(DEFAULT_ADMIN_VIEW)**.

- [ ] **Step 4: Run tests and typecheck**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/admin-view.test.ts
pnpm --filter @community-selection/admin typecheck
~~~

Expected: 2 tests pass; TypeScript exits 0.

- [ ] **Step 5: Commit**

~~~bash
git add apps/admin/src/app/admin-view.ts apps/admin/src/app/admin-view.test.ts apps/admin/src/App.tsx
git commit -m "refactor(admin): define stable view contract"
~~~

---

### Task 2: Introduce the Typed Request Boundary

**Files:**
- Create: **apps/admin/src/shared/api/errors.ts**
- Create: **apps/admin/src/shared/api/request-context.ts**
- Create: **apps/admin/src/shared/api/client.ts**
- Create: **apps/admin/src/shared/api/client.test.ts**
- Modify: **apps/admin/src/api/adminRequest.ts**

**Interfaces:**
- Produces: **AdminApiError**, **RequestContext**, **createJsonRequester**
- Preserves: **adminFetch**, **requestAdminJson**, **getAdminRequestHeaders**, **apiBaseUrl**

- [ ] **Step 1: Write failing client tests**

~~~ts
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from './errors';
import { createJsonRequester } from './client';

describe('createJsonRequester', () => {
  it('returns envelope data and sends request context headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { id: 'order-1' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const request = createJsonRequester({
      baseUrl: 'http://api.test',
      fetchImpl,
      getDefaultHeaders: () => ({ 'x-admin-role': 'owner' }),
    });

    await expect(
      request<{ id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ quantity: 1 }),
        context: {
          correlationId: 'corr-1',
          idempotencyKey: 'idem-1',
          timeoutMs: 1000,
        },
      }),
    ).resolves.toEqual({ id: 'order-1' });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/api/orders',
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-admin-role': 'owner',
          'x-correlation-id': 'corr-1',
          'idempotency-key': 'idem-1',
        }),
      }),
    );
  });

  it('normalizes a public API error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          code: 'ADMIN_FORBIDDEN',
          message: '无权限',
          trace_id: 'trace-1',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(request('/api/admin/private')).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 403,
      code: 'ADMIN_FORBIDDEN',
      traceId: 'trace-1',
      message: '无权限',
    } satisfies Partial<AdminApiError>);
  });

  it('aborts a request after its timeout budget', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(
      request('/api/slow', { context: { timeoutMs: 5 } }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });
});
~~~

- [ ] **Step 2: Run the client test and verify RED**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/shared/api/client.test.ts
~~~

Expected: FAIL because the shared API files do not exist.

- [ ] **Step 3: Implement the error and request-context types**

~~~ts
export type AdminApiErrorCode =
  | 'REQUEST_ABORTED'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | string;

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: AdminApiErrorCode,
    readonly traceId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AdminApiError';
  }
}
~~~

~~~ts
export type RequestContext = {
  correlationId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
};

export function requestContextHeaders(
  context: RequestContext | undefined,
): Record<string, string> {
  return {
    ...(context?.correlationId
      ? { 'x-correlation-id': context.correlationId }
      : {}),
    ...(context?.idempotencyKey
      ? { 'idempotency-key': context.idempotencyKey }
      : {}),
  };
}
~~~

- [ ] **Step 4: Implement createJsonRequester**

The implementation must:

- accept injected **fetchImpl** for deterministic tests;
- preserve **credentials: include**;
- merge default headers, request-context headers and caller headers in that order;
- add JSON content type only when a body exists and the caller did not set it;
- parse the existing **success/data/message** envelope;
- convert non-2xx or **success: false** responses to **AdminApiError**;
- distinguish caller abort, timeout, network failure and invalid JSON;
- clear timers and listeners in **finally**.

Public signature:

~~~ts
export type JsonRequestOptions = Omit<RequestInit, 'signal'> & {
  signal?: AbortSignal;
  context?: RequestContext;
};

export type JsonRequester = <T>(
  path: string,
  options?: JsonRequestOptions,
) => Promise<T>;

export function createJsonRequester(config: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getDefaultHeaders?: () => HeadersInit;
}): JsonRequester;
~~~

- [ ] **Step 5: Delegate the existing admin request API**

Keep **adminFetch** unchanged for CSV/blob callers. Construct one requester inside **adminRequest.ts**:

~~~ts
const requestJson = createJsonRequester({
  baseUrl: apiBaseUrl,
  getDefaultHeaders: () => getAdminRequestHeaders(false),
});

export function requestAdminJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  return requestJson<T>(path, init);
}
~~~

The compatibility wrapper must not add an idempotency key or change an endpoint. Existing modules such as **adminDashboardV2.ts** continue importing **requestAdminJson** without modification.

- [ ] **Step 6: Run focused and existing admin checks**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/shared/api/client.test.ts
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
~~~

Expected: 3 client tests pass; typecheck and build exit 0.

- [ ] **Step 7: Commit**

~~~bash
git add apps/admin/src/shared/api apps/admin/src/api/adminRequest.ts
git commit -m "refactor(admin): add typed request boundary"
~~~

---

### Task 3: Build the Feature Registry and Navigation Projection

**Files:**
- Create: **apps/admin/src/app/feature-registry.ts**
- Create: **apps/admin/src/app/feature-registry.test.ts**
- Create: **apps/admin/src/app/navigation.ts**
- Create: **apps/admin/src/app/navigation.test.ts**

**Interfaces:**
- Consumes: **AdminViewKey**, **ADMIN_VIEW_KEYS**
- Produces: **AdminFeatureDefinition**, **ADMIN_FEATURES**, **buildLegacyNavigation**

- [ ] **Step 1: Write the failing registry tests**

~~~ts
import { describe, expect, it } from 'vitest';
import { ADMIN_VIEW_KEYS } from './admin-view';
import { ADMIN_FEATURES } from './feature-registry';
import { buildLegacyNavigation } from './navigation';

describe('admin feature registry', () => {
  it('maps every non-login view exactly once', () => {
    const expected = ADMIN_VIEW_KEYS.filter((key) => key !== 'login');
    const actual = ADMIN_FEATURES.map((feature) => feature.key);
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it('preserves the L49 navigation labels and order', () => {
    expect(buildLegacyNavigation().map(({ key, label }) => [key, label]))
      .toEqual([
        ['products', '商品管理'],
        ['groupBuys', '团购管理'],
        ['failedGroupBuyClosure', '失败团购人工关闭'],
        ['orders', '订单管理'],
        ['fulfillment', '履约看板'],
        ['inventory', '库存管理'],
        ['purchasePlans', '采购计划'],
        ['suppliers', '供应商管理'],
        ['batches', '批次库存'],
        ['expiryAlerts', '临期提醒'],
        ['stockChecks', '库存盘点'],
        ['afterSales', '售后客服'],
        ['withdrawals', '提现管理'],
        ['alerts', '告警中心'],
        ['taxRecords', '税务人工 Review'],
        ['finance', '财务对账'],
        ['refundLedger', '退款台账'],
        ['rewardLedger', '开团服务奖励'],
        ['operations', '运营看板'],
        ['pickupWorkbench', '自提工作台'],
        ['deliveryReservation', '配送预留'],
        ['deliveryRuleConfig', '管理配送规则'],
        ['dashboardV2', '经营驾驶舱 V2'],
      ]);
  });
});
~~~

- [ ] **Step 2: Run the tests and verify RED**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/feature-registry.test.ts src/app/navigation.test.ts
~~~

Expected: FAIL because registry and navigation modules do not exist.

- [ ] **Step 3: Implement typed feature metadata**

~~~ts
import type { AdminViewKey } from './admin-view';

export type AdminFeatureSection =
  | 'catalog'
  | 'sales'
  | 'fulfillment'
  | 'inventory'
  | 'membership'
  | 'finance'
  | 'operations'
  | 'system';

export type AdminFeatureDefinition = {
  key: Exclude<AdminViewKey, 'login'>;
  label: string;
  section: AdminFeatureSection;
  requiredPermissions: readonly string[];
};

export const ADMIN_FEATURES = [
  { key: 'products', label: '商品管理', section: 'catalog', requiredPermissions: ['catalog.read'] },
  { key: 'groupBuys', label: '团购管理', section: 'sales', requiredPermissions: ['group-buy.read'] },
  { key: 'failedGroupBuyClosure', label: '失败团购人工关闭', section: 'sales', requiredPermissions: ['group-buy.close'] },
  { key: 'orders', label: '订单管理', section: 'sales', requiredPermissions: ['order.read'] },
  { key: 'fulfillment', label: '履约看板', section: 'fulfillment', requiredPermissions: ['fulfillment.read'] },
  { key: 'inventory', label: '库存管理', section: 'inventory', requiredPermissions: ['inventory.read'] },
  { key: 'purchasePlans', label: '采购计划', section: 'inventory', requiredPermissions: ['purchase.read'] },
  { key: 'suppliers', label: '供应商管理', section: 'inventory', requiredPermissions: ['supplier.read'] },
  { key: 'batches', label: '批次库存', section: 'inventory', requiredPermissions: ['inventory.batch.read'] },
  { key: 'expiryAlerts', label: '临期提醒', section: 'inventory', requiredPermissions: ['inventory.expiry.read'] },
  { key: 'stockChecks', label: '库存盘点', section: 'inventory', requiredPermissions: ['inventory.check.read'] },
  { key: 'afterSales', label: '售后客服', section: 'sales', requiredPermissions: ['after-sale.read'] },
  { key: 'withdrawals', label: '提现管理', section: 'finance', requiredPermissions: ['withdrawal.read'] },
  { key: 'alerts', label: '告警中心', section: 'operations', requiredPermissions: ['ops.alert.read'] },
  { key: 'taxRecords', label: '税务人工 Review', section: 'finance', requiredPermissions: ['tax.read'] },
  { key: 'finance', label: '财务对账', section: 'finance', requiredPermissions: ['finance.read'] },
  { key: 'refundLedger', label: '退款台账', section: 'finance', requiredPermissions: ['refund.read'] },
  { key: 'rewardLedger', label: '开团服务奖励', section: 'finance', requiredPermissions: ['reward.read'] },
  { key: 'operations', label: '运营看板', section: 'operations', requiredPermissions: ['operations.read'] },
  { key: 'pickupWorkbench', label: '自提工作台', section: 'fulfillment', requiredPermissions: ['pickup.read'] },
  { key: 'deliveryReservation', label: '配送预留', section: 'fulfillment', requiredPermissions: ['delivery.read'] },
  { key: 'deliveryRuleConfig', label: '管理配送规则', section: 'fulfillment', requiredPermissions: ['delivery.rule.read'] },
  { key: 'dashboardV2', label: '经营驾驶舱 V2', section: 'operations', requiredPermissions: ['dashboard.read'] },
] as const satisfies readonly AdminFeatureDefinition[];
~~~

The registry order must match the visible L49 button order. The new information architecture from the approved spec is not enabled until L50-B.

- [ ] **Step 4: Implement the pure navigation projection**

~~~ts
import { ADMIN_FEATURES } from './feature-registry';

export function buildLegacyNavigation() {
  return ADMIN_FEATURES.map(({ key, label }) => ({ key, label }));
}
~~~

- [ ] **Step 5: Run tests and typecheck**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/feature-registry.test.ts src/app/navigation.test.ts
pnpm --filter @community-selection/admin typecheck
~~~

Expected: registry/navigation tests pass; TypeScript exits 0.

- [ ] **Step 6: Commit**

~~~bash
git add apps/admin/src/app/feature-registry.ts apps/admin/src/app/feature-registry.test.ts apps/admin/src/app/navigation.ts apps/admin/src/app/navigation.test.ts
git commit -m "refactor(admin): register admin features"
~~~

---

### Task 4: Extract AdminShell and Page-Level Error Isolation

**Files:**
- Create: **apps/admin/src/app/AdminErrorBoundary.tsx**
- Create: **apps/admin/src/app/AdminShell.tsx**
- Create: **apps/admin/src/app/shell-model.ts**
- Create: **apps/admin/src/app/shell-model.test.ts**
- Modify: **apps/admin/src/App.tsx**

**Interfaces:**
- Consumes: **AdminViewKey**, **buildLegacyNavigation**
- Produces: **AdminShellProps**, **AdminErrorBoundary**, **createShellNavigationModel**

- [ ] **Step 1: Write a failing pure shell-model test**

~~~ts
import { describe, expect, it, vi } from 'vitest';
import { createShellNavigationModel } from './shell-model';

describe('shell navigation model', () => {
  it('marks the active view and delegates navigation', () => {
    const onNavigate = vi.fn();
    const items = createShellNavigationModel('orders', onNavigate);
    const orders = items.find((item) => item.key === 'orders');

    expect(orders?.active).toBe(true);
    orders?.onSelect();
    expect(onNavigate).toHaveBeenCalledWith('orders');
  });
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/shell-model.test.ts
~~~

Expected: FAIL because **shell-model.ts** does not exist.

- [ ] **Step 3: Implement the shell model**

~~~ts
import type { AdminViewKey } from './admin-view';
import { buildLegacyNavigation } from './navigation';

export function createShellNavigationModel(
  activeView: AdminViewKey,
  onNavigate: (view: AdminViewKey) => void,
) {
  return buildLegacyNavigation().map((item) => ({
    ...item,
    active: item.key === activeView,
    onSelect: () => onNavigate(item.key),
  }));
}
~~~

- [ ] **Step 4: Implement AdminErrorBoundary**

~~~tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button } from 'antd';

type Props = {
  resetKey: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('admin-page-render-failed', {
      name: error.name,
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert
        type="error"
        showIcon
        message="当前页面加载失败"
        description="其他后台模块仍可使用。请重试，若重复发生请记录时间和页面。"
        action={
          <Button onClick={() => this.setState({ error: null })}>
            重试当前页面
          </Button>
        }
      />
    );
  }
}
~~~

- [ ] **Step 5: Implement AdminShell**

~~~tsx
import type { ReactNode } from 'react';
import { Button, Card, Layout, Space, Typography } from 'antd';
import type { AdminViewKey } from './admin-view';
import { createShellNavigationModel } from './shell-model';

export type AdminShellProps = {
  activeView: AdminViewKey;
  admin: { username: string; role: string };
  message: string;
  onNavigate: (view: AdminViewKey) => void;
  onRefresh: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function AdminShell(props: AdminShellProps) {
  const items = createShellNavigationModel(
    props.activeView,
    props.onNavigate,
  );

  return (
    <Layout style={{ minHeight: '100vh', padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card>
          <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
          <Space wrap>
            {items.map((item) => (
              <Button
                key={item.key}
                type={item.active ? 'primary' : 'default'}
                onClick={item.onSelect}
              >
                {item.label}
              </Button>
            ))}
            <Button onClick={props.onRefresh}>刷新</Button>
            <Button onClick={props.onLogout}>退出登录</Button>
          </Space>
          <Typography.Text type="secondary">
            当前管理员：{props.admin.username}
          </Typography.Text>
          {props.message ? (
            <Typography.Text type="secondary">
              {props.message}
            </Typography.Text>
          ) : null}
        </Card>
        {props.children}
      </Space>
    </Layout>
  );
}
~~~

- [ ] **Step 6: Integrate without moving business logic**

In **App.tsx**:

1. keep the login card and all current view-specific JSX unchanged;
2. remove only the authenticated header card and its hard-coded navigation buttons;
3. when authenticated, wrap the existing view-specific JSX in **AdminShell**;
4. wrap that JSX in **AdminErrorBoundary** with **resetKey={view}**;
5. pass the existing **refresh**, **logoutAdmin**, **message**, **adminSession**, **view** and **setView** callbacks;
6. do not apply **requiredPermissions** to navigation in this stage;
7. preserve the current label and order through **buildLegacyNavigation**.

Authenticated composition:

~~~tsx
<AdminShell
  activeView={view}
  admin={adminSession}
  message={message}
  onNavigate={setView}
  onRefresh={refresh}
  onLogout={() => void logoutAdmin()}
>
  <AdminErrorBoundary resetKey={view}>
    {featureContent}
  </AdminErrorBoundary>
</AdminShell>
~~~

Define **featureContent** as the existing view-condition block moved without changing its API calls, prompts, table columns, copy or action handlers.

- [ ] **Step 7: Run focused and static checks**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/shell-model.test.ts src/app/feature-registry.test.ts src/app/navigation.test.ts
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
~~~

Expected: shell/registry/navigation tests pass; typecheck and build exit 0.

- [ ] **Step 8: Commit**

~~~bash
git add apps/admin/src/app apps/admin/src/App.tsx
git commit -m "refactor(admin): extract shell and error boundary"
~~~

---

### Task 5: Establish the Stable AdminApp Entry Point

**Files:**
- Create: **apps/admin/src/app/AdminApp.tsx**
- Modify: **apps/admin/src/App.tsx**
- Verify unchanged: **apps/admin/src/main.tsx**

**Interfaces:**
- Produces: **AdminApp**
- Preserves: named export **App** consumed by **main.tsx**

- [ ] **Step 1: Add a failing entry-point contract test**

~~~ts
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { AdminApp } from './AdminApp';

describe('admin entry point', () => {
  it('keeps App as the compatibility alias for AdminApp', () => {
    expect(App).toBe(AdminApp);
  });
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/AdminApp.test.ts
~~~

Expected: FAIL because **AdminApp.tsx** does not exist.

- [ ] **Step 3: Move orchestration to AdminApp**

Move the complete implementation currently exported as **App** into **apps/admin/src/app/AdminApp.tsx** and rename the function to **AdminApp**. Update relative imports from the new directory:

- existing page imports change from **./pages/** to **../pages/**;
- shared-format import remains **@community-selection/shared**;
- app-local imports use **./admin-view**, **./AdminShell**, and **./AdminErrorBoundary**.

Replace **apps/admin/src/App.tsx** with:

~~~ts
export { AdminApp as App } from './app/AdminApp';
~~~

Do not modify **main.tsx**.

- [ ] **Step 4: Run the entry contract, all admin tests, typecheck and build**

Run:

~~~bash
pnpm --filter @community-selection/admin test -- src/app/AdminApp.test.ts
pnpm --filter @community-selection/admin test
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
~~~

Expected: entry test and all admin tests pass; typecheck and build exit 0.

- [ ] **Step 5: Commit**

~~~bash
git add apps/admin/src/App.tsx apps/admin/src/app/AdminApp.tsx apps/admin/src/app/AdminApp.test.ts
git commit -m "refactor(admin): establish AdminApp entry"
~~~

---

### Task 6: Final Gate and Stage Evidence

**Files:**
- Modify only if required by the existing reporting workflow: **docs/reports/** stage entry generated by repository scripts
- No production source change is allowed after verification unless its failing check is reproduced first

**Interfaces:**
- Verifies every interface produced in Tasks 1–5
- Produces merge evidence for the L50-A1 PR

- [ ] **Step 1: Confirm scope**

Run:

~~~bash
git status -sb
git diff --stat stable/l49-business-base...HEAD
git diff --name-only stable/l49-business-base...HEAD
~~~

Expected:

- only Admin A1 source/tests and an optional generated stage report are changed;
- no Prisma, migration, lockfile, miniapp, payment, inventory business service or API route file appears.

- [ ] **Step 2: Run the complete relevant gate**

Run:

~~~bash
pnpm --filter @community-selection/shared build
pnpm --filter @community-selection/config build
pnpm --filter @community-selection/admin test
pnpm --filter @community-selection/admin typecheck
pnpm --filter @community-selection/admin build
pnpm typecheck
pnpm lint
~~~

Expected: every command exits 0; Vitest reports zero failed tests.

- [ ] **Step 3: Run the repository verification gate**

Run:

~~~bash
pnpm verify:all
~~~

Expected: exit 0. If the script requires environment-specific services, record the exact unavailable prerequisite and run every service-independent subcommand named by the script; do not report the aggregate gate as passed.

- [ ] **Step 4: Manual admin smoke**

With the existing API and admin containers running:

~~~bash
pnpm --filter @community-selection/admin dev
~~~

Verify:

1. unauthenticated startup still shows the existing login form;
2. successful login lands on 商品管理;
3. all 23 authenticated navigation buttons appear in the L49 order;
4. each button switches to its current page;
5. 刷新 and 退出登录 still invoke the current behavior;
6. a page render failure is contained inside the workspace and navigation remains usable;
7. browser network requests use the same paths and cookie credentials as L49.

Record browser version, API commit, admin commit and the result for all seven checks in the PR body.

- [ ] **Step 5: Review requirements line by line**

Confirm:

- no endpoint, payload, response mapping or business action changed;
- no permission metadata is used as authorization;
- no dependency or lockfile changed;
- App remains import-compatible for **main.tsx**;
- request errors expose status, code and trace ID without logging PII;
- timeout and abort do not leave timers or event listeners;
- the page registry contains each non-login view exactly once;
- a render error in one view cannot replace the shell.

- [ ] **Step 6: Create the implementation PR**

After all available gates pass:

~~~bash
git push -u origin codex/l50-a1-admin-foundation
~~~

Open a PR targeting the latest stable branch. The PR body must link #84 and this plan, list exact automated and manual evidence, and state that L50-A2 begins only after this PR is merged and a new stable checkpoint exists.

## Plan Self-Review Result

- Spec coverage: L50-A foundation, request boundary, feature registry, shell, page isolation and compatibility entry are covered.
- Deliberate exclusions: per-feature state extraction and removal of the global refresh are assigned to L50-A2/A3 because they require independently reviewable behavior changes.
- Placeholder scan: the plan contains no unresolved implementation marker or unspecified test step.
- Type consistency: **AdminViewKey**, **JsonRequester**, **AdminFeatureDefinition**, **AdminShellProps** and **AdminApp** have one definition and matching consumers.
- Safety: authorization remains server-side; payment, refund, inventory and database behavior are outside this PR.
