# L51 Real WeChat Commerce Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace client-trusted identity and MOCK-only payment wiring with a production-safe WeChat login, JSAPI payment, verified notification, reconciliation, and failed-group refund loop.

**Architecture:** Keep the Fastify + Prisma monolith and preserve the L50 write-owner boundaries. Isolate external WeChat HTTP/crypto from database commands; make provider callbacks and schedulers converge on the existing payment/refund domain owners through idempotent receipts and stable merchant identifiers.

**Tech Stack:** Node.js 20+, TypeScript, Fastify 5, Prisma 6, PostgreSQL, Vitest, native WeChat miniapp JavaScript, Node `crypto` and `fetch`.

## Global Constraints

- Do not add Redis, MQ, microservices, Kubernetes, POS, coupons, flash sales, or multilevel rewards.
- Production identity comes only from a server-issued Bearer session; client `user_id` and `openid` fields are rejected.
- Production money state changes only after a verified provider notification or an authenticated provider query.
- Use integer cents and CNY throughout.
- Keep private keys, APIv3 keys, certificates, session tokens, `session_key`, and raw notifications out of Git and logs.
- Preserve the L50 Payment, Order, GroupBuy, Inventory, Refund, Commission, Audit, and Alert write owners.
- All provider commands use stable merchant identifiers and are safe to retry.
- The temporary recovery workflow and trigger marker must not exist in the final implementation tree.

---

### Task 1: Persistence contracts for sessions, receipts, provider state, and alerts

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202607270001_l51_wechat_commerce_loop/migration.sql`
- Create: `apps/api/src/modules/wechat/wechat-schema.contract.test.ts`

**Interfaces:**
- Produces: `UserSession`, `WechatNotificationReceipt`, payment attempt/provider fields, refund provider fields, and `OpsAlertLog.dedupe_key`.

- [ ] **Step 1: Write the failing schema contract**

```ts
expect(schema).toContain('model UserSession');
expect(schema).toContain('model WechatNotificationReceipt');
expect(schema).toMatch(/attempt_no\s+Int\s+@default\(1\)/);
expect(schema).toMatch(/dedupe_key\s+String\?\s+@unique/);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @community-selection/api test -- wechat-schema.contract.test.ts`

Expected: FAIL because the L51 models and fields do not exist.

- [ ] **Step 3: Add the minimal Prisma schema and SQL migration**

Use unique constraints for `token_hash`, `notification_id`, `order_id + attempt_no`, and `dedupe_key`; add indexes for receipt status, session expiry, and provider reconciliation scans.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm db:generate && pnpm --filter @community-selection/api test -- wechat-schema.contract.test.ts`

Expected: PASS.

### Task 2: Fail-closed runtime configuration and WeChat login sessions

**Files:**
- Create: `apps/api/src/modules/wechat/wechat-config.ts`
- Create: `apps/api/src/modules/wechat/wechat-login-client.ts`
- Create: `apps/api/src/modules/current-user/user-session-owner.ts`
- Create: `apps/api/src/modules/current-user/user-session-owner.test.ts`
- Create: `apps/api/src/routes/wechat-auth.ts`
- Create: `apps/api/src/routes/wechat-auth.test.ts`
- Modify: `apps/api/src/modules/current-user/current-user-security.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `.env.example`
- Modify: `scripts/validate-env.ts`

**Interfaces:**
- Produces: `loadWechatRuntimeConfig(env)`, `exchangeWechatLoginCode(code)`, `issueUserSession(userId)`, `authenticateBearer(request)`, and `/api/auth/wechat/login|logout`.

- [ ] **Step 1: Write failing tests for strict config, code exchange, token hashing, expiry, disabled users, and Bearer authentication**

```ts
expect(() => loadWechatRuntimeConfig({ NODE_ENV: 'production', WECHAT_PAY_MODE: 'wechat' }))
  .toThrow(/WECHAT_APP_ID/);
expect(persisted.token_hash).not.toBe(plainToken);
expect(await authenticateBearer(`Bearer ${plainToken}`)).toMatchObject({ user_id });
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @community-selection/api test -- user-session-owner.test.ts wechat-auth.test.ts`

Expected: FAIL because the modules/routes do not exist.

- [ ] **Step 3: Implement the minimum production path**

Use HMAC-SHA-256 with `USER_SESSION_TOKEN_SECRET`, 32 random bytes, a 30-day default expiry, strict login DTO parsing, one `code2session` call, user upsert by openid without overwriting role/status/profile, and no persistence of `session_key`.

- [ ] **Step 4: Verify GREEN**

Run the focused tests and `pnpm --filter @community-selection/api typecheck`.

### Task 3: WeChat Pay v3 request signing and notification verification

**Files:**
- Create: `apps/api/src/modules/wechat/wechat-pay-v3-client.ts`
- Create: `apps/api/src/modules/wechat/wechat-pay-v3-client.test.ts`
- Create: `apps/api/src/modules/wechat/wechat-notify-verifier.ts`
- Create: `apps/api/src/modules/wechat/wechat-notify-verifier.test.ts`
- Create: `apps/api/test/fixtures/wechat-test-private-key.pem`
- Create: `apps/api/test/fixtures/wechat-test-certificate.pem`

**Interfaces:**
- Produces: `createWechatAuthorization`, `createJsapiPaySignature`, `createJsapiTransaction`, `queryTransaction`, `closeTransaction`, `applyRefund`, `queryRefund`, and `verifyAndDecryptWechatNotification`.

- [ ] **Step 1: Write failing deterministic crypto tests**

Assert canonical messages contain method, path/query, timestamp, nonce, and exact body; assert RSA signatures verify with the test certificate; assert wrong serial, stale timestamp, changed raw body, and invalid AES-GCM authentication tags fail closed.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @community-selection/api test -- wechat-pay-v3-client.test.ts wechat-notify-verifier.test.ts`

- [ ] **Step 3: Implement with Node `crypto` and injected `fetch`**

Do not add a payment SDK. Parse private key/certificate paths at startup, use RSA-SHA256, exact raw request bytes, a five-minute timestamp window, and AES-256-GCM with the APIv3 key.

- [ ] **Step 4: Verify GREEN**

Run the focused crypto tests twice to prove deterministic fixtures and no network dependency.

### Task 4: Server-owned JSAPI initialization and payment success convergence

**Files:**
- Create: `apps/api/src/modules/payment/wechat-payment-command.ts`
- Create: `apps/api/src/modules/payment/wechat-payment-command.test.ts`
- Create: `apps/api/src/modules/payment/wechat-payment-notification.ts`
- Create: `apps/api/src/modules/payment/wechat-payment-notification.test.ts`
- Modify: `apps/api/src/routes/payments.ts`
- Modify: `apps/api/src/services/payment-service.ts`
- Modify: `apps/api/src/modules/payment/payment-record-service.ts`
- Create: `apps/api/src/routes/payment-status.ts`

**Interfaces:**
- Consumes: authenticated user/openid, WeChat Pay client, notification verifier, and L50 payment success owners.
- Produces: `initializeWechatJsapiPayment`, `applyWechatPaymentNotification`, and `/api/me/orders/:id/payment-status`.

- [ ] **Step 1: Write failing tests**

Assert unknown fields and client identity are rejected; cross-user orders are forbidden; DB amount/openid win; concurrent initialization reuses one valid attempt; replayed receipt returns success without a second projection; same notification ID with a changed body fails and alerts.

- [ ] **Step 2: Verify RED**

Run focused command, notification, and route tests.

- [ ] **Step 3: Implement minimal commands**

Lock the order/payment rows, generate `PAY<stable-order-ref><attempt>`, persist prepay expiry, call the provider outside long database transactions, and route verified success through `markOrderPaid` with provider success time.

- [ ] **Step 4: Verify GREEN**

Run focused tests plus existing payment ownership contracts.

### Task 5: Reliable WeChat refunds and refund notifications

**Files:**
- Create: `apps/api/src/modules/refund/wechat-refund-command.ts`
- Create: `apps/api/src/modules/refund/wechat-refund-command.test.ts`
- Create: `apps/api/src/modules/refund/wechat-refund-notification.ts`
- Create: `apps/api/src/modules/refund/wechat-refund-notification.test.ts`
- Modify: `apps/api/src/routes/refunds.ts`
- Modify: `apps/api/src/services/refund-service.ts`
- Modify: `apps/api/src/modules/refund/refund-record-service.ts`

**Interfaces:**
- Produces: `createWechatRefundIntent`, `submitWechatRefund`, and `applyWechatRefundNotification`.

- [ ] **Step 1: Write failing tests**

Assert stable `client_refund_id` replay, conflict on changed order/amount, provider timeout leaves one queryable refund, only verified `SUCCESS` invokes the L50 refund projection, and duplicate notification/query races project once.

- [ ] **Step 2: Verify RED**

Run the focused refund tests.

- [ ] **Step 3: Implement through existing refund write owners**

Keep intent creation transactional, provider calls outside the transaction, provider state separate from business success, and never store a raw decrypted notification.

- [ ] **Step 4: Verify GREEN**

Run focused tests plus existing refund ownership and integration tests.

### Task 6: Group expiry, reconciliation, and deduplicated alerts

**Files:**
- Modify: `apps/api/src/modules/group-buy/group-buy-expiry-service.ts`
- Create: `apps/api/src/modules/group-buy/wechat-group-expiry-command.ts`
- Create: `apps/api/src/modules/group-buy/wechat-group-expiry-command.test.ts`
- Create: `apps/api/src/modules/wechat/wechat-reconciler.ts`
- Create: `apps/api/src/modules/wechat/wechat-reconciler.test.ts`
- Create: `apps/api/src/modules/operations/ops-alert-owner.ts`
- Create: `apps/api/src/modules/operations/ops-alert-owner.test.ts`

**Interfaces:**
- Produces: `reconcileWechatState(now)`, `expireDueWechatGroupBuys(now)`, and `upsertOpsAlert(dedupeKey, ...)`.

- [ ] **Step 1: Write failing race/retry tests**

Assert one advisory-lock holder, query-before-close, provider `SUCCESS` converges before group decision, failed groups create exactly one refund per paid order, and repeated scans do not duplicate refunds, stock restoration, reward cancellation, or alerts.

- [ ] **Step 2: Verify RED**

Run the focused group expiry/reconciler tests.

- [ ] **Step 3: Implement idempotent scanning**

Use PostgreSQL advisory locks, bounded batches, stable alert keys, stable `group-failed:<group>:<order>` refund keys, and retain retryable states after provider/network uncertainty.

- [ ] **Step 4: Verify GREEN**

Run focused tests and the PostgreSQL integration gate.

### Task 7: Miniapp session, runtime mode, and real payment interaction

**Files:**
- Modify: `apps/miniapp/app.js`
- Modify: `apps/miniapp/config.js`
- Modify: `apps/miniapp/utils/api.js`
- Create: `apps/miniapp/utils/session.js`
- Create: `apps/miniapp/utils/payment.js`
- Modify: `apps/miniapp/pages/orders/confirm/index.js`
- Modify: `apps/miniapp/pages/join-order/index.js`
- Modify: `apps/miniapp/pages/orders/detail/index.js`
- Create: `apps/miniapp/utils/session.test.cjs`
- Create: `apps/miniapp/utils/payment.test.cjs`

**Interfaces:**
- Produces: one-shot login refresh, Authorization injection, `payOrder(orderId)`, `wx.requestPayment`, and backend payment-state polling.

- [ ] **Step 1: Write failing contract tests**

Assert production requests include Bearer and omit mock identity headers/body fields; a 401 triggers at most one relogin; `payment_mode=wechat` calls JSAPI then `wx.requestPayment`; cancellation preserves the unpaid order; frontend success polls backend instead of marking paid.

- [ ] **Step 2: Verify RED**

Run: `node --test apps/miniapp/utils/session.test.cjs apps/miniapp/utils/payment.test.cjs`

- [ ] **Step 3: Implement minimal miniapp wiring**

MOCK is allowed only when runtime explicitly returns `payment_mode=mock`. Production config rejects localhost and never calls `/api/payments/mock`.

- [ ] **Step 4: Verify GREEN**

Run focused miniapp tests and existing miniapp business contract tests.

### Task 8: Release gates, documentation, and publication

**Files:**
- Modify: `docs/ops/wechat-pay-switch-checklist.md`
- Modify: `docs/production-checklist.md`
- Create: `docs/reviews/l51-real-wechat-commerce-loop.md`
- Create: `scripts/verify-l51-wechat-commerce-loop.ts`
- Modify: `package.json`
- Delete: `.github/workflows/l51-workspace-recovery.yml`
- Delete: `.github/l51-workspace-recovery.trigger`

**Interfaces:**
- Produces: `pnpm verify:l51` and an auditable rollout/0.01-yuan acceptance checklist.

- [ ] **Step 1: Add a failing static release gate**

The gate rejects missing L51 routes/models/tests, production localhost/MOCK wiring, client identity fields in checkout, secret-like fixture values, and retained recovery files.

- [ ] **Step 2: Verify RED, then complete documentation and wiring**

Run: `pnpm verify:l51`

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm verify:l51
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:all
```

- [ ] **Step 4: Publish the complete tree to `codex/l51-real-wechat-commerce-loop`**

Build from the exact remote base tree, delete the two recovery paths, update Draft PR #117, and verify the remote head after publication.

- [ ] **Step 5: Run the community Runner release gate**

Require payment/refund ownership contracts, PostgreSQL integration, miniapp contracts, production build, and full release gate to pass before marking the PR ready.
