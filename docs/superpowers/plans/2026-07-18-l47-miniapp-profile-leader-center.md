# L47 Miniapp Profile V2 and Leader Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a two-layer miniapp center: a personal center for every authenticated user and a leader center for group-buy, reward, and manual-withdrawal summaries, with tests written alongside each implementation slice.

**Architecture:** Upgrade the existing `pages/mine` page instead of creating a duplicate profile page. Add two read-only Fastify endpoints backed by a focused `me-center` service that uses Prisma count/aggregate queries and returns explicit DTOs rather than Prisma rows. Reuse the existing leader withdrawal page for submission, and register L47 in the existing stage registry, Docker E2E, chain, and report workflow.

**Tech Stack:** TypeScript, Fastify 5, Prisma 6, PostgreSQL, native WeChat miniapp JavaScript/WXML/WXSS, repository verifier scripts executed with `tsx`, Docker Compose E2E.

## Global Constraints

- Stable base is `stable/l46-business-base` at `fe7b8c185816912d5e198dc960f8b979b532525f`.
- Development branch is `work/l47-miniapp-profile-leader-center-v2`.
- L47 only; do not implement L48 security/privacy work beyond removing sensitive output directly encountered in the L47 page/API surface.
- Do not modify `package.json` or `pnpm-lock.yaml`.
- Do not modify `prisma/schema.prisma` or create migrations.
- Do not commit `reports/` or `.tmp/` to the business branch.
- Amounts remain integer cents in APIs and persistence; display formatting occurs in miniapp utilities.
- Do not expose `openid`, phone numbers, bank data, tax fields, admin notes, full manual references, Prisma errors, or stack traces.
- Do not add multi-level distribution, team income, recruiting compensation, rankings, growth campaigns, coupons, membership, referral growth, automatic payout, or automatic tax filing.
- Rewards remain first-level opening-service rewards derived only from the leader's own valid group-buy orders.
- Tests and implementation advance in the same commit sequence; a task is not complete until its focused verifier passes.

---

## File Map

### Create

- `scripts/l47-center-contract.ts` — machine-readable API paths, response keys, status sets, runtime markers, and prohibited output keys.
- `scripts/verify-l47-miniapp-profile-leader-center-local.ts` — L47 static and pure-service verifier.
- `apps/api/src/modules/me-center/me-center-types.ts` — explicit DTOs and status constants.
- `apps/api/src/modules/me-center/me-center-service.ts` — all aggregation queries and DTO mapping.
- `apps/api/src/routes/me/center.ts` — authenticated personal-center endpoint.
- `apps/api/src/routes/leaders/center.ts` — authenticated leader-only endpoint.
- `apps/miniapp/utils/center.js` — center API methods and cents formatter.
- `apps/miniapp/pages/leader/center/index.js`
- `apps/miniapp/pages/leader/center/index.json`
- `apps/miniapp/pages/leader/center/index.wxml`
- `apps/miniapp/pages/leader/center/index.wxss`
- `docs/reviews/l47-miniapp-profile-leader-center.md` — reviewer-facing scope and acceptance notes.

### Modify

- `apps/api/src/routes/public/index.ts` — register both new user-side route modules.
- `apps/miniapp/utils/api.js` — preserve HTTP status/code on rejected request errors.
- `apps/miniapp/pages/mine/index.js` — load the personal-center DTO with stale-response protection.
- `apps/miniapp/pages/mine/index.wxml` — replace OpenID display with identity, order, after-sale, and leader navigation cards.
- `apps/miniapp/pages/mine/index.wxss` — personal-center V2 presentation and states.
- `apps/miniapp/pages/mine/index.json` — title becomes `个人中心`.
- `apps/miniapp/app.json` — register leader center before the existing withdrawal page.
- `scripts/verify-docker-api-e2e-local.ts` — deterministic L47 fixtures, endpoint calls, assertions, and markers.
- `scripts/stage-registry.ts` — register L47 and its report base.
- `scripts/verify-all-local.sh` — extend registered verifier range to L47.
- `scripts/generate-stage-report.ts` — include L47 API contract and seven verification rows.
- `scripts/verify-report-publish-local.ts` — validate L47 changed-file coverage, API rows, verification evidence, risk, and unfinished sections.
- `scripts/verify-report-stage-routing-local.ts` — add L47 routing and historical-isolation fixtures.
- `scripts/verify-stage-registry-local.ts` — assert L47 is the latest registered stage and uses the L46 base.
- `scripts/verify-stage-verifier-architecture-local.ts` — include L47 in registry-driven architecture checks where the file currently lists latest-stage expectations.

---

### Task 1: Add the L47 contract and a failing verifier

**Files:**
- Create: `scripts/l47-center-contract.ts`
- Create: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Produces: `L47_CENTER_API_CONTRACT`, `L47_RUNTIME_MARKERS`, `L47_PROHIBITED_RESPONSE_KEYS`, and `L47_ALLOWED_CHANGED_PATHS`.
- Consumes later: backend routes, miniapp pages, Docker E2E, report generator, report verifier.

- [ ] **Step 1: Create the machine contract**

Use this exact public shape:

```ts
export const L47_CENTER_API_CONTRACT = [
  {
    method: 'GET',
    path: '/api/me/center-summary',
    auth: 'current user',
    response_sections: ['profile', 'orders', 'after_sales', 'navigation', 'updated_at'],
  },
  {
    method: 'GET',
    path: '/api/leaders/me/center-summary',
    auth: 'current leader',
    response_sections: ['group_buys', 'rewards', 'withdrawals', 'navigation', 'updated_at'],
  },
] as const;

export const L47_PENDING_AFTER_SALE_STATUSES = ['submitted', 'reviewing', 'approved', 'processing'] as const;
export const L47_PENDING_FULFILLMENT_ORDER_STATUSES = ['paid', 'grouped', 'preparing'] as const;
export const L47_DELIVERY_ACTIVE_ORDER_STATUSES = ['ready', 'delivered'] as const;
export const L47_ACTIVE_GROUP_BUY_STATUSES = ['pending'] as const;
export const L47_SUCCESS_GROUP_BUY_STATUSES = ['success', 'preparing', 'ready', 'fulfilled'] as const;
export const L47_FAILED_GROUP_BUY_STATUSES = ['failed', 'cancelled'] as const;
export const L47_PENDING_COMMISSION_STATUSES = ['estimated', 'frozen', 'pending'] as const;
export const L47_WITHDRAWING_STATUSES = ['pending', 'approved'] as const;
export const L47_PROCESSED_WITHDRAWAL_STATUSES = ['paid'] as const;

export const L47_RUNTIME_MARKERS = [
  'l47_me_center_summary_success=true',
  'l47_me_center_order_counts_verified=true',
  'l47_me_center_after_sale_count_verified=true',
  'l47_leader_center_summary_success=true',
  'l47_leader_group_buy_counts_verified=true',
  'l47_leader_reward_amounts_verified=true',
  'l47_leader_withdrawal_summary_verified=true',
  'l47_non_leader_forbidden=true',
  'l47_sensitive_fields_absent=true',
  'l47_miniapp_navigation_verified=true',
] as const;

export const L47_PROHIBITED_RESPONSE_KEYS = [
  'openid',
  'unionid',
  'phone',
  'receiver_phone',
  'bank_account_no',
  'tax_mode',
  'tax_status',
  'tax_amount_cents',
  'tax_remark',
  'admin_remark',
  'manual_reference',
] as const;
```

- [ ] **Step 2: Write the verifier before implementation**

The verifier must read files with `readFileSync`, use an `assert()` helper that throws, import the constants above, and check all of these facts:

```ts
assert(publicRoutes.includes("registerMeCenterRoutes(app)"), 'Personal center route must be registered');
assert(publicRoutes.includes("registerLeaderCenterRoutes(app)"), 'Leader center route must be registered');
assert(meRoute.includes("'/api/me/center-summary'"), 'Personal center endpoint missing');
assert(leaderRoute.includes("'/api/leaders/me/center-summary'"), 'Leader center endpoint missing');
assert(leaderRoute.includes("user.role !== 'leader'"), 'Leader role guard missing');
assert(mineWxml.includes('个人中心'), 'Personal center heading missing');
assert(!mineWxml.includes('OpenID'), 'Personal center must not render OpenID');
assert(appJson.pages.includes('pages/leader/center/index'), 'Leader center route missing from app.json');
assert(leaderCenterJs.includes('/pages/leader/withdrawals/index'), 'Leader center must reuse existing withdrawal page');
assert(!combinedMiniappSource.includes('自动到账'), 'L47 must not promise automatic payout');
```

The verifier must also reject any L47 diff containing:

```text
package.json
pnpm-lock.yaml
prisma/schema.prisma
prisma/migrations/
reports/
.tmp/
```

Use `git diff --name-only stable/l46-business-base...HEAD` and compare each changed path against the L47 allow-list.

- [ ] **Step 3: Run the verifier and confirm red state**

Run:

```bash
docker compose exec -T api sh -lc '
cd /app &&
pnpm exec tsx scripts/verify-l47-miniapp-profile-leader-center-local.ts
'
```

Expected: non-zero exit with the first missing route or file assertion. A passing result at this point means the verifier is not testing the planned feature.

- [ ] **Step 4: Commit the red contract**

```bash
git add scripts/l47-center-contract.ts scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "test: add failing L47 center contract"
```

---

### Task 2: Implement typed aggregation services

**Files:**
- Create: `apps/api/src/modules/me-center/me-center-types.ts`
- Create: `apps/api/src/modules/me-center/me-center-service.ts`
- Modify: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Produces:
  - `getMeCenterSummary(userId: string): Promise<MeCenterSummary>`
  - `getLeaderCenterSummary(userId: string): Promise<LeaderCenterSummary>`
  - `mapWithdrawalStatusText(status: string): string`
  - `sumDirectionGroups(rows): number`
- Consumes: Prisma models already present through L46; status arrays from `scripts/l47-center-contract.ts` are duplicated into API types only as readonly constants with the same values and checked by the verifier.

- [ ] **Step 1: Add exact DTO definitions**

```ts
export type MeCenterSummary = {
  profile: {
    user_id: string;
    nickname: string | null;
    avatar_url: string | null;
    role: 'customer' | 'leader';
  };
  orders: {
    total_count: number;
    unpaid_count: number;
    pending_fulfillment_count: number;
    ready_for_pickup_count: number;
    in_delivery_count: number;
    completed_count: number;
  };
  after_sales: { pending_count: number };
  navigation: { leader_center_available: boolean };
  updated_at: string;
};

export type LeaderCenterSummary = {
  group_buys: {
    total_count: number;
    active_count: number;
    success_count: number;
    failed_count: number;
  };
  rewards: {
    pending_cents: number;
    available_cents: number;
    withdrawing_cents: number;
    withdrawn_cents: number;
  };
  withdrawals: {
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    processed_count: number;
    latest: Array<{
      withdrawal_id: string;
      amount_cents: number;
      status: string;
      status_text: string;
      created_at: string;
    }>;
  };
  navigation: { withdrawal_entry_available: boolean };
  updated_at: string;
};
```

- [ ] **Step 2: Add pure helpers and verifier assertions**

```ts
export function mapWithdrawalStatusText(status: string): string {
  return ({ pending: '待审核', approved: '已通过', rejected: '已拒绝', paid: '已处理' } as Record<string, string>)[status] ?? status;
}

export function sumDirectionGroups(rows: Array<{ direction: string; _sum: { amount_cents: number | null } }>): number {
  return rows.reduce((total, row) => {
    const value = row._sum.amount_cents ?? 0;
    return total + (row.direction === 'in' ? value : -value);
  }, 0);
}
```

Extend the verifier to import these functions and assert:

```ts
assert(mapWithdrawalStatusText('pending') === '待审核', 'pending text mismatch');
assert(mapWithdrawalStatusText('paid') === '已处理', 'paid text mismatch');
assert(sumDirectionGroups([
  { direction: 'in', _sum: { amount_cents: 1200 } },
  { direction: 'out', _sum: { amount_cents: 300 } },
]) === 900, 'available reward balance formula mismatch');
```

- [ ] **Step 3: Implement `getMeCenterSummary` with count queries**

Use `prisma.$transaction([...])` with these exact filters:

```ts
const [total, unpaid, pendingFulfillment, readyForPickup, inDelivery, completed, pendingAfterSales] = await prisma.$transaction([
  prisma.order.count({ where: { user_id: userId } }),
  prisma.order.count({ where: { user_id: userId, pay_status: 'unpaid', order_status: 'unpaid' } }),
  prisma.order.count({ where: { user_id: userId, pay_status: 'paid', order_status: { in: ['paid', 'grouped', 'preparing'] } } }),
  prisma.order.count({ where: { user_id: userId, pickup_type: 'store', order_status: 'ready' } }),
  prisma.order.count({ where: { user_id: userId, pickup_type: 'delivery', order_status: { in: ['ready', 'delivered'] } } }),
  prisma.order.count({ where: { user_id: userId, order_status: 'completed' } }),
  prisma.afterSaleCase.count({ where: { user_id: userId, status: { in: ['submitted', 'reviewing', 'approved', 'processing'] } } }),
]);
```

Load the user with a narrow select:

```ts
const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { id: true, nickname: true, avatar_url: true, role: true },
});
```

Do not select `openid`, `unionid`, or `phone`.

- [ ] **Step 4: Implement `getLeaderCenterSummary` with aggregates**

Use database counts/grouping and at most five withdrawal rows:

```ts
const [totalGroups, activeGroups, successGroups, failedGroups, pendingCommission, ledgerGroups, withdrawalGroups, latestWithdrawals] = await prisma.$transaction([
  prisma.groupBuy.count({ where: { leader_user_id: userId } }),
  prisma.groupBuy.count({ where: { leader_user_id: userId, status: { in: ['pending'] } } }),
  prisma.groupBuy.count({ where: { leader_user_id: userId, status: { in: ['success', 'preparing', 'ready', 'fulfilled'] } } }),
  prisma.groupBuy.count({ where: { leader_user_id: userId, status: { in: ['failed', 'cancelled'] } } }),
  prisma.commission.aggregate({ where: { leader_user_id: userId, status: { in: ['estimated', 'frozen', 'pending'] } }, _sum: { final_amount_cents: true } }),
  prisma.rewardLedger.groupBy({ by: ['direction'], where: { leader_user_id: userId, affects_available_balance: true }, _sum: { amount_cents: true } }),
  prisma.withdrawal.groupBy({ by: ['status'], where: { leader_user_id: userId }, _count: { _all: true }, _sum: { amount_cents: true } }),
  prisma.withdrawal.findMany({ where: { leader_user_id: userId }, select: { id: true, amount_cents: true, status: true, created_at: true }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 5 }),
]);
```

Derive values without floating point:

```ts
const countByStatus = Object.fromEntries(withdrawalGroups.map((row) => [row.status, row._count._all]));
const amountByStatus = Object.fromEntries(withdrawalGroups.map((row) => [row.status, row._sum.amount_cents ?? 0]));
const availableCents = sumDirectionGroups(ledgerGroups);
```

Return `available_cents: Math.max(0, availableCents)`, `withdrawing_cents` from pending + approved withdrawal amounts, and `withdrawn_cents` from paid withdrawal amounts.

- [ ] **Step 5: Run the focused verifier**

Run the same L47 verifier command.

Expected: still fails because route and miniapp files are absent, while pure helper assertions pass.

- [ ] **Step 6: Commit the service slice**

```bash
git add apps/api/src/modules/me-center scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "feat: add L47 center aggregation services"
```

---

### Task 3: Add authenticated center routes

**Files:**
- Create: `apps/api/src/routes/me/center.ts`
- Create: `apps/api/src/routes/leaders/center.ts`
- Modify: `apps/api/src/routes/public/index.ts`
- Modify: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Consumes: `resolveUserIdentity`, `getMeCenterSummary`, `getLeaderCenterSummary`.
- Produces: `GET /api/me/center-summary` and `GET /api/leaders/me/center-summary` using the repository's `ok()` / `fail()` envelope.

- [ ] **Step 1: Add the personal-center route**

```ts
import type { FastifyInstance } from 'fastify';
import { fail, ok } from '@community-selection/shared';
import { getMeCenterSummary } from '../../modules/me-center/me-center-service.js';
import { resolveUserIdentity } from '../../modules/user-orders/user-order-service.js';

export function registerMeCenterRoutes(app: FastifyInstance) {
  app.get('/api/me/center-summary', async (request, reply) => {
    try {
      const user = await resolveUserIdentity(request);
      return ok(await getMeCenterSummary(user.id));
    } catch (error) {
      reply.code((error as { statusCode?: number }).statusCode ?? 500);
      return fail(error instanceof Error ? error.message : '个人中心加载失败');
    }
  });
}
```

- [ ] **Step 2: Add the leader-center route**

Use the same identity resolver, then fail with 403 before querying leader data:

```ts
if (user.role !== 'leader') {
  reply.code(403);
  return fail('仅开团人可访问团长中心');
}
```

The catch block must return 500 for unknown errors and never stringify Prisma details or stack traces.

- [ ] **Step 3: Register both routes**

Add imports and calls to `apps/api/src/routes/public/index.ts`:

```ts
import { registerMeCenterRoutes } from '../me/center.js';
import { registerLeaderCenterRoutes } from '../leaders/center.js';
```

```ts
registerMeCenterRoutes(app);
registerLeaderCenterRoutes(app);
```

- [ ] **Step 4: Run the L47 verifier**

Expected: API path and role-guard checks pass; miniapp assertions remain red.

- [ ] **Step 5: Run API typecheck**

```bash
docker compose exec -T api sh -lc '
cd /app && pnpm --filter @community-selection/api typecheck
'
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes apps/api/src/modules/me-center scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "feat: expose L47 personal and leader center APIs"
```

---

### Task 4: Upgrade request errors and the existing personal center

**Files:**
- Create: `apps/miniapp/utils/center.js`
- Modify: `apps/miniapp/utils/api.js`
- Modify: `apps/miniapp/pages/mine/index.js`
- Modify: `apps/miniapp/pages/mine/index.wxml`
- Modify: `apps/miniapp/pages/mine/index.wxss`
- Modify: `apps/miniapp/pages/mine/index.json`
- Modify: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Produces:
  - `getMeCenterSummary()`
  - `getLeaderCenterSummary()`
  - `formatCents(cents)`
  - rejected request errors carrying `statusCode` and `code`.

- [ ] **Step 1: Preserve HTTP metadata in `utils/api.js`**

Replace both rejection branches with an error factory:

```js
function requestError(message, statusCode, body) {
  const error = new Error(message);
  error.statusCode = Number(statusCode || 0);
  error.code = body && typeof body.code === 'string' ? body.code : '';
  return error;
}
```

Use `reject(requestError(message, statusCode, body))` for HTTP errors and `reject(requestError(message, statusCode, body))` for `body.success === false`.

- [ ] **Step 2: Add center API utility**

```js
const { getJSON, formatYuan } = require('./api');

function getMeCenterSummary() {
  return getJSON('/api/me/center-summary');
}

function getLeaderCenterSummary() {
  return getJSON('/api/leaders/me/center-summary');
}

function formatCents(cents) {
  return `¥${formatYuan(cents)}`;
}

module.exports = { getMeCenterSummary, getLeaderCenterSummary, formatCents };
```

- [ ] **Step 3: Replace local-only mine-page loading with guarded refresh**

Keep existing community, pickup-store, cart, and navigation behavior. Add:

```js
const { getMeCenterSummary } = require('../../utils/center');

Page({
  data: {
    user: null,
    summary: null,
    loading: false,
    loaded: false,
    error: '',
    community: null,
    pickupStore: null,
    cartCount: 0,
  },
  onLoad() {
    this.requestSeq = 0;
  },
  onShow() {
    this.refreshLocalState();
    this.loadSummary();
  },
  async loadSummary() {
    const seq = ++this.requestSeq;
    this.setData({ loading: true, error: '' });
    try {
      const summary = await getMeCenterSummary();
      if (seq !== this.requestSeq) return;
      this.setData({ summary, loaded: true });
    } catch (error) {
      if (seq !== this.requestSeq) return;
      this.setData({ error: error.message || '个人中心加载失败' });
    } finally {
      if (seq === this.requestSeq) this.setData({ loading: false });
    }
  },
  retry() { this.loadSummary(); },
  goLeaderCenter() { wx.navigateTo({ url: '/pages/leader/center/index' }); },
  goAfterSales() { wx.navigateTo({ url: '/pages/orders/index?status=after_sale' }); },
});
```

- [ ] **Step 4: Replace the WXML**

The personal center must render:

- nickname and role text from `summary.profile`;
- no OpenID;
- order counts for unpaid, pending fulfillment, ready pickup, delivery active, completed;
- pending after-sale count;
- leader-center button only under `wx:if="{{summary.navigation.leader_center_available}}"`;
- first-load error with retry button;
- refresh error that keeps the previous summary visible;
- existing community, pickup store, cart, and orders navigation.

The visible page title must contain `个人中心` so the static verifier can identify the V2 page.

- [ ] **Step 5: Run verifier**

Expected: personal-center checks pass; leader-center checks remain red.

- [ ] **Step 6: Commit**

```bash
git add apps/miniapp/utils/api.js apps/miniapp/utils/center.js apps/miniapp/pages/mine scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "feat: upgrade miniapp personal center V2"
```

---

### Task 5: Add the leader center and reuse withdrawals

**Files:**
- Create: `apps/miniapp/pages/leader/center/index.js`
- Create: `apps/miniapp/pages/leader/center/index.json`
- Create: `apps/miniapp/pages/leader/center/index.wxml`
- Create: `apps/miniapp/pages/leader/center/index.wxss`
- Modify: `apps/miniapp/app.json`
- Modify: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Consumes: `getLeaderCenterSummary`, `formatCents`, and existing `/pages/leader/withdrawals/index`.
- Produces: read-only leader overview with deterministic refresh behavior and 403 handling.

- [ ] **Step 1: Add guarded leader-page loading**

```js
const { getLeaderCenterSummary, formatCents } = require('../../../utils/center');

Page({
  data: { summary: null, view: null, loading: false, loaded: false, error: '', forbidden: false },
  onLoad() { this.requestSeq = 0; },
  onShow() { this.loadSummary(); },
  async loadSummary() {
    const seq = ++this.requestSeq;
    this.setData({ loading: true, error: '', forbidden: false });
    try {
      const summary = await getLeaderCenterSummary();
      if (seq !== this.requestSeq) return;
      this.setData({
        summary,
        view: {
          pending: formatCents(summary.rewards.pending_cents),
          available: formatCents(summary.rewards.available_cents),
          withdrawing: formatCents(summary.rewards.withdrawing_cents),
          withdrawn: formatCents(summary.rewards.withdrawn_cents),
          latest: summary.withdrawals.latest.map((item) => ({ ...item, amount_text: formatCents(item.amount_cents) })),
        },
        loaded: true,
      });
    } catch (error) {
      if (seq !== this.requestSeq) return;
      this.setData({ forbidden: error.statusCode === 403, error: error.message || '团长中心加载失败' });
    } finally {
      if (seq === this.requestSeq) this.setData({ loading: false });
    }
  },
  retry() { this.loadSummary(); },
  goWithdrawals() { wx.navigateTo({ url: '/pages/leader/withdrawals/index' }); },
  goBackToMine() { wx.navigateBack({ delta: 1 }); },
});
```

- [ ] **Step 2: Add WXML sections**

Render:

- active, success, and failed group-buy counts;
- pending, available, withdrawing, and processed reward amounts;
- recent withdrawal records;
- empty states when arrays/counts are zero;
- a button to the existing withdrawal page, disabled when `withdrawal_entry_available` is false;
- the exact compliance statement: `开团服务奖励只来自本人真实有效团购订单；提现由后台人工审核并线下处理。`;
- a 403 state with a return button and no automatic retry loop.

- [ ] **Step 3: Register route**

Update `apps/miniapp/app.json` so these paths both exist:

```json
"pages/leader/center/index",
"pages/leader/withdrawals/index"
```

- [ ] **Step 4: Run L47 verifier**

Expected: all feature-file assertions pass. The verifier may still fail on stage registration because Task 7 is not complete.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/app.json apps/miniapp/pages/leader/center scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "feat: add miniapp leader center"
```

---

### Task 6: Add deterministic Docker E2E coverage

**Files:**
- Modify: `scripts/verify-docker-api-e2e-local.ts`
- Modify: `scripts/verify-l47-miniapp-profile-leader-center-local.ts`

**Interfaces:**
- Produces all ten `L47_RUNTIME_MARKERS` exactly once on a successful run.
- Consumes existing `PrismaClient`, HTTP helpers, unique run-token conventions, and the two new API endpoints.

- [ ] **Step 1: Define a unique fixture prefix**

Inside `runL47CenterScenario()` use:

```ts
const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const prefix = `l47-${runToken}`;
```

Every unique openid, order number, client request ID, product name, community name, and withdrawal request ID created by this scenario must include `prefix`.

- [ ] **Step 2: Build one customer and one leader fixture**

The customer fixture must include:

- one unpaid order;
- one paid/preparing order;
- one ready store-pickup order;
- one ready delivery order;
- one completed order;
- one pending after-sale case and one resolved case.

The leader fixture must include:

- one pending group buy;
- one success group buy;
- one failed group buy;
- pending commission amount 700;
- available ledger net amount 900 (`in 1200`, `out 300`);
- pending withdrawal amount 400;
- approved withdrawal amount 200;
- paid withdrawal amount 500;
- at least six withdrawals so stable `take: 5` behavior is asserted.

- [ ] **Step 3: Call and assert the personal endpoint**

```ts
const me = await api<MeCenterSummary>('/api/me/center-summary', { headers: { 'x-openid': customer.openid } });
assert(me.orders.unpaid_count === 1, 'L47 unpaid count mismatch');
assert(me.orders.pending_fulfillment_count === 1, 'L47 fulfillment count mismatch');
assert(me.orders.ready_for_pickup_count === 1, 'L47 pickup count mismatch');
assert(me.orders.in_delivery_count === 1, 'L47 delivery count mismatch');
assert(me.orders.completed_count === 1, 'L47 completed count mismatch');
assert(me.after_sales.pending_count === 1, 'L47 pending after-sale count mismatch');
assert(me.navigation.leader_center_available === false, 'Customer must not receive leader entry');
```

- [ ] **Step 4: Assert role boundary**

Call `/api/leaders/me/center-summary` with the customer openid and assert HTTP 403. Call it with the leader openid and assert counts, amounts, latest length `5`, and descending `(created_at, id)` order.

- [ ] **Step 5: Assert sensitive fields are absent**

Serialize both response data objects and reject every key in `L47_PROHIBITED_RESPONSE_KEYS`. Also reject fixture openid and phone values from the serialized output.

- [ ] **Step 6: Emit exact markers**

After assertions, print every marker from `L47_RUNTIME_MARKERS`. Do not print a marker before its corresponding assertion passes.

- [ ] **Step 7: Register scenario in `main()`**

Call:

```ts
await runL47CenterScenario();
```

before `assertNoRiskFindings()` and before `Docker API E2E verification passed.`.

- [ ] **Step 8: Run Docker E2E**

```bash
docker compose exec -T api sh -lc '
cd /app && API_BASE_URL=http://127.0.0.1:13080 pnpm exec tsx scripts/verify-docker-api-e2e-local.ts --debug
'
```

Expected: all ten L47 markers and `Docker API E2E verification passed.`.

- [ ] **Step 9: Commit**

```bash
git add scripts/verify-docker-api-e2e-local.ts scripts/verify-l47-miniapp-profile-leader-center-local.ts
git commit -m "test: add L47 center Docker E2E"
```

---

### Task 7: Register L47 in stage and report tooling

**Files:**
- Modify: `scripts/stage-registry.ts`
- Modify: `scripts/verify-all-local.sh`
- Modify: `scripts/generate-stage-report.ts`
- Modify: `scripts/verify-report-publish-local.ts`
- Modify: `scripts/verify-report-stage-routing-local.ts`
- Modify: `scripts/verify-stage-registry-local.ts`
- Modify: `scripts/verify-stage-verifier-architecture-local.ts`
- Create: `docs/reviews/l47-miniapp-profile-leader-center.md`

**Interfaces:**
- Produces: L47 as the latest stage, report base `stable/l46-business-base`, seven report verification rows, and contract-driven API report rows.

- [ ] **Step 1: Add report contract and registry entry**

Add:

```ts
L47: {
  sourceMode: 'git_diff',
  businessBaseBranch: 'stable/l46-business-base',
  businessBaseCommit: 'fe7b8c185816912d5e198dc960f8b979b532525f',
}
```

Append:

```ts
{
  id: 'L47',
  number: 47,
  title: 'Miniapp Profile V2 and Leader Center',
  verifier: 'scripts/verify-l47-miniapp-profile-leader-center-local.ts',
}
```

- [ ] **Step 2: Extend verify-all range**

Change only:

```bash
pnpm exec tsx scripts/run-registered-stage-verifiers.ts --from=L24 --to=L47
```

- [ ] **Step 3: Generate L47 API and verification sections**

Import `L47_CENTER_API_CONTRACT` and render exactly two API rows. L47 verification rows are:

```text
L47 verifier
L24-L47 chain regression
Docker API E2E
Admin typecheck config
Admin full typecheck
raw compliance scan
Stage workflow
```

A missing command marker must produce `not detected`, never `passed`.

- [ ] **Step 4: Add L47 publish verification**

The L47 validator must assert:

- report source commit equals current HEAD;
- exact changed-file set equals `git diff --name-only stable/l46-business-base...HEAD`;
- `.gitignore`, `package.json`, lockfile, schema, migration, `reports/`, and `.tmp/` are absent from the L47 diff;
- two API rows match the contract;
- DB section states no DB change;
- all seven verification rows are `passed`;
- all ten Docker markers exist;
- no prohibited response key appears in generated API/DTO examples;
- high-risk and unfinished sections contain no unresolved generated item.

- [ ] **Step 5: Extend routing and registry verifiers**

Assert:

```ts
latestRegisteredStage().id === 'L47'
getStageDefinition('L47')?.reportContract?.businessBaseCommit === 'fe7b8c185816912d5e198dc960f8b979b532525f'
getStageChain('L47')[0] === 'L47'
getStageChain('L47').at(-1) === 'L24'
```

Historical L43-L46 fixtures must remain unchanged and must not execute L47-specific assertions.

- [ ] **Step 6: Add reviewer document**

Document endpoint scope, status semantics, reward formulas, sensitive-field exclusions, no-DB-change decision, miniapp navigation, manual withdrawal disclaimer, and the exact final verification command.

- [ ] **Step 7: Run focused tooling checks**

```bash
docker compose exec -T api sh -lc '
cd /app &&
pnpm exec tsx scripts/verify-stage-registry-local.ts &&
pnpm exec tsx scripts/verify-stage-verifier-architecture-local.ts &&
pnpm exec tsx scripts/verify-report-stage-routing-local.ts &&
pnpm exec tsx scripts/verify-report-markdown-local.ts &&
pnpm exec tsx scripts/verify-l47-miniapp-profile-leader-center-local.ts
'
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/stage-registry.ts scripts/verify-all-local.sh scripts/generate-stage-report.ts scripts/verify-report-publish-local.ts scripts/verify-report-stage-routing-local.ts scripts/verify-stage-registry-local.ts scripts/verify-stage-verifier-architecture-local.ts docs/reviews/l47-miniapp-profile-leader-center.md
git commit -m "chore: register L47 stage and report gates"
```

---

### Task 8: Full chain, report publication, and PR preparation

**Files:**
- Verification only; no generated reports committed to the business branch.

**Interfaces:**
- Produces: commit-bound `stage-reports` artifacts and an L47 PR targeting `stable/l46-business-base`.

- [ ] **Step 1: Check forbidden business-branch changes**

```bash
git diff --name-only stable/l46-business-base...HEAD
git diff --check stable/l46-business-base...HEAD
```

Expected: no dependency files, Prisma files, `reports/`, or `.tmp/`.

- [ ] **Step 2: Run the L47 stage verifier**

```bash
docker compose exec -T api sh -lc '
cd /app && pnpm exec tsx scripts/stage-workflow.ts --stage=L47 --verify --scope=stage
'
```

Expected: `command_completed:L47 verifier=true` and `Stage workflow verification passed.`.

- [ ] **Step 3: Run the full chain and local no-push publication**

Run in detached/background mode to avoid terminal rendering failure:

```bash
GH_TOKEN="$(gh auth token)"
AUTH_B64="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"

docker compose exec -d \
  -e GIT_CONFIG_COUNT=1 \
  -e GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \
  -e GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $AUTH_B64" \
  -e GIT_TERMINAL_PROMPT=0 \
  api sh -lc '
cd /app || exit 90
mkdir -p reports
rm -f reports/final-l47-run.log reports/final-l47-run.exit
STATUS=0
pnpm exec tsx scripts/stage-workflow.ts --stage=L47 --publish --scope=chain > reports/final-l47-run.log 2>&1 || STATUS=$?
printf "%s\n" "$STATUS" > reports/final-l47-run.exit
exit "$STATUS"
'

unset GH_TOKEN AUTH_B64
```

- [ ] **Step 4: Monitor completion without launching a duplicate process**

```bash
docker compose exec -T api sh -lc '
cd /app
echo "status=$(cat reports/final-l47-run.exit 2>/dev/null || echo RUNNING)"
echo "log_size=$(wc -c < reports/final-l47-run.log 2>/dev/null || echo 0)"
tail -n 40 reports/final-l47-run.log 2>/dev/null || true
'
```

Expected final status: `0`.

- [ ] **Step 5: Verify commit-bound evidence**

```bash
docker compose exec -T api sh -lc '
set -eu
cd /app
EXPECTED="$(git rev-parse HEAD)"
test "$(head -n 1 reports/latest-verify-output.txt)" = "verification_source_commit:$EXPECTED"
grep -F "command_completed:L47 verifier=true" reports/latest-verify-output.txt
grep -F "command_completed:L24-L47 chain regression=true" reports/latest-verify-output.txt
grep -F "command_completed:Docker API E2E=true" reports/latest-verify-output.txt
grep -F "command_completed:Admin typecheck=true" reports/latest-verify-output.txt
grep -F "command_completed:raw compliance scan=true" reports/latest-verify-output.txt
grep -F "command_completed:Stage workflow=true" reports/latest-verify-output.txt
grep -F "command_completed:report:publish L47=true" reports/latest-verify-output.txt
'
```

- [ ] **Step 6: Push `stage-reports` and verify parity**

```bash
git push origin stage-reports
git fetch origin stage-reports
git rev-list --left-right --count origin/stage-reports...stage-reports
```

Expected: `0 0`.

- [ ] **Step 7: Push business branch and create PR**

```bash
git push origin work/l47-miniapp-profile-leader-center-v2
```

Create a PR from `work/l47-miniapp-profile-leader-center-v2` to `stable/l46-business-base`. The body must list current HEAD, all focused verifiers, L24-L47 chain, Docker E2E, no-DB/no-dependency confirmation, sensitive-field checks, and the current `stage-reports` metadata. Do not enable auto-merge.

---

## Plan Self-Review

- Spec coverage: both centers, authentication, aggregation, no-DB rule, sensitive-field exclusion, existing withdrawal reuse, miniapp states, Docker E2E, stage chain, and report publication each map to an implementation task.
- Placeholder scan: every task names exact files, interfaces, commands, expected outcomes, and commit boundaries.
- Type consistency: DTO field names match the approved design and are reused in service, routes, miniapp utility, E2E, and report contract.
- Scope check: L47 remains one cohesive feature; L48, dependencies, migrations, ranking, growth, automated payout, and automated tax are excluded.
