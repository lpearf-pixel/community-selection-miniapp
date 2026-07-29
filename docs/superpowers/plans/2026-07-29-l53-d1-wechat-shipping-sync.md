# L53-D1 WeChat Shipping Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably upload local-delivery and verified-pickup fulfillment facts to WeChat without making WeChat the order state owner.

**Architecture:** The existing delivery and pickup commands create one durable `WechatShippingIntent` inside their current PostgreSQL transactions. A scheduled worker obtains a PostgreSQL advisory lock, claims due intents, builds a sanitized WeChat payload from real Payment/User data, and records success, retry, or manual intervention independently of the local order transition.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, React/Ant Design, WeChat Mini Program API, Vitest.

## Global Constraints

- Delivery creates an intent only on the first transition into `delivering`.
- Store pickup creates an intent only when authenticated pickup verification writes `picked`.
- `Order` is the sole fulfillment source of truth; provider failure never rolls it back.
- Only a real successful `Payment.transaction_id` and the owning `User.openid` may identify the WeChat order.
- Delivery maps to logistics type `2`; pickup maps to logistics type `4`; delivery mode is `1`.
- One intent exists per order; successful intents are terminal.
- Retryable errors use bounded exponential backoff; deterministic errors require manual intervention.
- No token, app secret, complete openid, or receiver contact is persisted in the intent or exposed to Admin.
- Do not add MQ, Redis, microservices, split shipment, express tracking, provider callbacks, or user-triggered sync.
- Run focused tests and typechecks during D1; defer full container gates to L53 closure.

---

### Task 1: Durable intent and transactional producers

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260729200000_l53_wechat_shipping_intent/migration.sql`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-intent.ts`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-intent.test.ts`
- Modify: `apps/api/src/modules/delivery/admin-delivery-status-executor.ts`
- Modify: `apps/api/src/modules/delivery/admin-delivery-status-executor.integration.test.ts`
- Modify: `apps/api/src/modules/order/admin-pickup-verification-executor.ts`
- Modify: `apps/api/src/modules/order/admin-pickup-verification-executor.integration.test.ts`

**Interfaces:**
- Produces: `createWechatShippingIntent(tx, { orderId, trigger, logisticsType })`.
- Persists: one `WechatShippingIntent` per `order_id` with status, attempt/error timestamps, and no provider credentials or consumer identity.

- [ ] **Step 1: Write the failing pure intent tests**

Add table-driven tests proving `pending_dispatch -> delivering` produces `{ trigger: "delivery_started", logisticsType: 2 }`, pickup verification produces `{ trigger: "pickup_verified", logisticsType: 4 }`, and unrelated transitions return no intent.

- [ ] **Step 2: Run the pure test and verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/wechat-shipping/wechat-shipping-intent.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add the enum, table, migration, and minimal intent helper**

Use a unique `order_id`, statuses `pending|processing|retryable|succeeded|manual_required`, triggers `delivery_started|pickup_verified`, integer `logistics_type`, `attempt_count`, `last_error_code`, `next_retry_at`, `succeeded_at`, timestamps, and an `Order` relation. The helper uses `upsert` with an empty update so replay cannot reset success.

- [ ] **Step 4: Run the pure test and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write failing PostgreSQL producer scenarios**

Require delivery intent creation in the same transaction as the first `delivering` transition, pickup intent creation in the same transaction as `picked`, no duplicate on idempotent replay, and no surviving intent when either command transaction rolls back.

- [ ] **Step 6: Run the producer integration tests and verify RED**

Run the two existing executor integration files with `DATABASE_URL`. Expected: FAIL because neither command writes the intent.

- [ ] **Step 7: Call the helper from both command transactions**

Call it after the guarded order update and before command receipt completion. Pass only order ID, approved trigger, and literal logistics type.

- [ ] **Step 8: Run producer integration tests and verify GREEN**

Run the Step 6 command. Expected: PASS.

### Task 2: WeChat API client and payload policy

**Files:**
- Create: `apps/api/src/modules/wechat/wechat-access-token-client.ts`
- Create: `apps/api/src/modules/wechat/wechat-access-token-client.test.ts`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-client.ts`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-client.test.ts`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-policy.ts`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-policy.test.ts`

**Interfaces:**
- Produces: `createWechatAccessTokenClient({ appId, appSecret, fetchImpl, now })`.
- Produces: `createWechatShippingClient({ getAccessToken, fetchImpl })`.
- Produces: `buildWechatShippingPayload(record)` and `classifyWechatShippingError(error)`.

- [ ] **Step 1: Write failing token-cache tests**

Prove one token is reused before expiry, refreshed 300 seconds before expiry, HTTP/WeChat errors are normalized to stable codes, and secret/token text never appears in thrown errors.

- [ ] **Step 2: Run token tests and verify RED**

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the minimal in-memory token client**

Call `/cgi-bin/token?grant_type=client_credential&appid=...&secret=...`, validate `access_token` and `expires_in`, and retain only token plus expiry in closure state.

- [ ] **Step 4: Run token tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Write failing payload/client/error tests**

Use literal fixtures to require `order_key.order_number_type=1`, real `transaction_id`, `delivery_mode=1`, logistics type `2|4`, one sanitized `shipping_list` item, and `payer.openid`. Require retry classification for network/timeout/429/5xx/system-busy and manual classification for parameter, permission, missing payment, and missing identity errors.

- [ ] **Step 6: Run payload/client tests and verify RED**

Expected: FAIL because the policy and client do not exist.

- [ ] **Step 7: Implement the strict payload and upload client**

POST to `/wxa/sec/order/upload_shipping_info?access_token=...`, reject malformed success responses, strip control characters, cap item description length, and expose only normalized error codes.

- [ ] **Step 8: Run payload/client tests and verify GREEN**

Expected: PASS.

### Task 3: Reliable worker and scheduler

**Files:**
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-worker.ts`
- Create: `apps/api/src/modules/wechat-shipping/wechat-shipping-worker.test.ts`
- Create: `apps/api/src/services/wechat-shipping-jobs.ts`
- Create: `apps/api/src/services/wechat-shipping-jobs.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces: `runWechatShippingJobs(now)` and `startWechatShippingScheduler()`.
- Consumes: due intents plus real successful payment transaction ID, user openid, and product description.

- [ ] **Step 1: Write failing worker behavior tests**

Require successful terminal state, retryable state with literal 1/2/4/8/16/30-minute delays, deterministic `manual_required`, missing real payment/identity without provider call, maximum batch size 20, and no selection of `succeeded`.

- [ ] **Step 2: Run worker tests and verify RED**

Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement the minimal worker**

Use injected claim/load/upload/save ports. Persist `processing` before upload, increment attempts once per claim, then record exactly one outcome without logging payload identity.

- [ ] **Step 4: Run worker tests and verify GREEN**

Expected: PASS.

- [ ] **Step 5: Write failing job orchestration tests**

Require a PostgreSQL advisory lock, a due-intent query ordered by creation time with `take: 20`, real-payment selection, sanitized alert payload, real-mode-only scheduler startup, and overlap prevention.

- [ ] **Step 6: Run orchestration tests and verify RED**

Expected: FAIL because the service does not exist and server does not start it.

- [ ] **Step 7: Implement job orchestration and scheduler**

Build clients from existing runtime config, start only in real WeChat mode, use a one-minute unref timer, and keep this scheduler independent from the payment/refund transaction.

- [ ] **Step 8: Run orchestration tests and verify GREEN**

Expected: PASS.

### Task 4: Admin visibility and manual retry

**Files:**
- Modify: `apps/api/src/routes/admin/order-list-query.ts`
- Modify: `apps/api/src/routes/admin/order-list-query.test.ts`
- Modify: `apps/api/src/routes/admin/orders.ts`
- Create: `apps/api/src/modules/wechat-shipping/admin-wechat-shipping-retry.ts`
- Create: `apps/api/src/modules/wechat-shipping/admin-wechat-shipping-retry.test.ts`
- Modify: `apps/admin/src/features/sales/orders/types.ts`
- Modify: `apps/admin/src/features/sales/orders/api.ts`
- Modify: `apps/admin/src/features/sales/orders/OrderDetailsCard.tsx`
- Modify: `apps/admin/src/features/sales/orders/OrdersPage.tsx`

**Interfaces:**
- Produces: safe shipping-sync summary on Admin order DTOs.
- Produces: `POST /api/admin/orders/:id/wechat-shipping-retry` guarded by `order.manage`.

- [ ] **Step 1: Write failing safe-DTO and retry tests**

Require status/attempt/error/timestamps, forbid transaction ID/openid/token fields, reject absent or successful intents, and restore only `retryable|manual_required` to `pending`.

- [ ] **Step 2: Run focused API/Admin tests and verify RED**

Expected: FAIL because the DTO and command do not exist.

- [ ] **Step 3: Implement the retry owner and V1 route**

Use admin scope checks, `order.manage`, one transaction, Admin audit, business event, and stable 404/409/403 codes. The route never calls WeChat directly.

- [ ] **Step 4: Add safe Admin rendering**

Render Chinese status labels and timestamps in the selected order detail. Show “重新加入同步队列” only for `retryable` and `manual_required`, and refresh after success.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/wechat-shipping src/routes/admin/order-list-query.test.ts
pnpm --filter @community-selection/api typecheck
pnpm --filter @community-selection/admin typecheck
pnpm lint
```

Expected: all commands exit 0.

### Task 5: D1 verification and PR evidence

**Files:**
- Create: `docs/reviews/l53-d1-wechat-shipping-sync.md`
- Modify: PR #119 description after the commit is published.

**Interfaces:**
- Produces: a reproducible record of focused verification and known first-launch exclusions.

- [ ] **Step 1: Run the complete D1 focused verification**

Run policy/client/worker/unit tests, both producer integration tests once on PostgreSQL, API/Admin typechecks, and lint. Do not run a production image build.

- [ ] **Step 2: Review the requirement checklist**

Confirm every approved trigger, identifier, idempotency, retry, privacy, Admin, and exclusion item maps to implementation plus test evidence.

- [ ] **Step 3: Publish one atomic commit**

Re-read PR #119 HEAD, create one tree whose parent is that exact HEAD, and fast-forward `codex/l53-first-launch-closure`. Do not force-push or issue sequential file commits.

- [ ] **Step 4: Record remote evidence**

Confirm the commit changed only D1 files, fetch the remote content, and report Actions as pending/green/failed without inferring success.
