# L50-C2-T2 Pickup Verification Reliable Write Design

## 1. Goal

Move store-pickup verification behind one authenticated, permission-scoped, data-scoped, versioned, idempotent and atomic Admin command. After this task, an order can enter `picked` only through the pickup-verification command, and only when the current order is a store-pickup order in `ready` state.

## 2. Confirmed Business Rules

- Pickup verification is allowed only when `pickup_type=store` and `order_status=ready`.
- Delivery orders must use the delivery fulfillment path and can never be pickup-verified.
- The generic Admin order-status command must reject `next_status=picked`; pickup verification is the sole write boundary for `picked`.
- The Admin UI shows “核销自提” only for store-pickup orders in `ready`.
- The generic “已自提” button is removed.
- A delivery order that is already in transit uses a later cancellation-application flow with merchant confirmation and delivery interception. That flow is recorded separately and is outside C2-T2.
- A successful pickup verification changes the order from `ready` to `picked`; it does not complete the order and does not trigger completion rewards.

## 3. Scope

### Included

- Upgrade `POST /api/admin/orders/:id/pickup-verify` to an Admin V1 command.
- Require current Admin identity and active account.
- Require `pickup.verify` permission.
- Recheck current order data scope before mutation and before idempotent replay.
- Require `expected_version` and `idempotency_key`.
- Accept an optional `admin_remark` with an explicit bounded contract.
- Perform the order update, version increment, business event, order timeline, Admin audit and command receipt completion in one PostgreSQL transaction.
- Return stable V1 success and error envelopes with a trace ID.
- Provide real PostgreSQL evidence for concurrency, replay, authorization and rollback.
- Provide Admin browser evidence for the visible action, request contract, success refresh and 409 refresh.
- Preserve the C2-T1 Admin status command for all still-supported status transitions except `picked`.

### Excluded

- Delivery cancellation, delivery interception, refunds or after-sales behavior.
- POS integration, QR-code or numeric pickup-code generation.
- Customer-side pickup confirmation.
- Inventory, commission or reward changes.
- Outbox/inbox, Redis, message queues or distributed locks.
- New database tables, columns, migrations or dependencies.
- A database-provider change from PostgreSQL to MySQL.

## 4. Current Risks Closed by This Task

The existing route checks permission and data scope but delegates to a legacy service that:

- accepts any `ready` order, including delivery orders;
- treats an already-`picked` order as a successful retry without an idempotency key;
- does not use `Order.version`;
- writes event and timeline entries through best-effort helpers;
- can be bypassed by the generic “已自提” status action;
- returns legacy error envelopes that collapse distinct failures into HTTP 400.

C2-T2 removes these ambiguities and makes one command responsible for the entire pickup-verification write.

## 5. API Contract

### Endpoint

```http
POST /api/admin/orders/:id/pickup-verify
```

The route sets `adminContractV1: true` and uses `requireAdminPermissionV1('pickup.verify')`.

### Request

```json
{
  "expected_version": 4,
  "idempotency_key": "pickup-verify-01HZX123456789",
  "admin_remark": "顾客现场出示取货信息"
}
```

Rules:

- `expected_version` is a safe integer greater than or equal to 1.
- `idempotency_key` is 16–128 printable ASCII characters, has no leading or trailing whitespace, and is preserved exactly.
- `admin_remark` is optional. When present it must be a string of at most 500 JavaScript string code units, must not have leading or trailing whitespace, and must not contain control characters other than ordinary Unicode text. An absent remark is represented canonically as `null`.
- Unknown or malformed bodies return HTTP 400 and never enter the executor.

### Success

HTTP 200:

```json
{
  "success": true,
  "data": {
    "order_id": "order-id",
    "order_no": "O202607240001",
    "order_status": "picked",
    "version": 5
  },
  "code": "ADMIN_PICKUP_VERIFIED",
  "message": "自提核销成功",
  "trace_id": "request-trace-id"
}
```

The same Admin, same idempotency key and same canonical command returns the saved success response without producing another order update, event, timeline entry or audit row.

### Errors

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `INVALID_ADMIN_PICKUP_VERIFY_COMMAND` | Body, version, key or remark is invalid |
| 401 | `ADMIN_UNAUTHORIZED` | Admin identity is missing, inactive or invalid |
| 403 | `ADMIN_FORBIDDEN` | `pickup.verify` permission or current data scope is missing |
| 404 | `ADMIN_ORDER_NOT_FOUND` | The order does not exist |
| 409 | `ADMIN_IDEMPOTENCY_KEY_REUSED` | The same Admin/key refers to a different target, version or remark |
| 409 | `ADMIN_ORDER_VERSION_CONFLICT` | The visible version is stale |
| 409 | `ADMIN_PICKUP_TYPE_CONFLICT` | The order is not a store-pickup order |
| 409 | `ADMIN_PICKUP_STATE_CONFLICT` | The order is not currently `ready` |
| 500 | `ADMIN_PICKUP_VERIFY_FAILED` | A sanitized internal failure occurred |

All failures use the C2-T1 V1 failure envelope, include `trace_id`, and never return raw Prisma, PostgreSQL, stack-trace or request-header details.

## 6. Command and Hash

Create a focused parser and executor for operation:

```text
admin.order.pickup.verify.v1
```

The canonical request hash includes:

```json
{
  "operation": "admin.order.pickup.verify.v1",
  "target_id": "order-id",
  "expected_version": 4,
  "admin_remark": "顾客现场出示取货信息"
}
```

The idempotency key is not included in the hash because it is the lookup key. The receipt remains uniquely identified by `(admin_user_id, idempotency_key)` through the existing `AdminCommandReceipt` table.

A replay must not trust the historical receipt alone. The executor reloads the target order and reapplies the current Admin data scope before returning the saved response. Permission and active-account checks are also rerun by the route guard on every request.

## 7. Transaction Algorithm

The command uses a short Prisma interactive transaction:

1. Create an incomplete `AdminCommandReceipt` for the Admin and key.
2. Load the current order inside the transaction.
3. Return `ADMIN_ORDER_NOT_FOUND` if absent.
4. Recheck `canAccessOrderDataScope(context, order)`; reject with `ADMIN_FORBIDDEN` before any business write.
5. Check `pickup_type=store`.
6. Check `order_status=ready`.
7. Check `order.version === expected_version`.
8. Perform a conditional update matching `id`, `version`, `pickup_type=store` and `order_status=ready`; set `order_status=picked` and increment `version`.
9. Strictly write one `pickup_verified` business event.
10. Strictly write one `pickup_verified` order timeline entry with Admin actor information and the bounded remark.
11. Strictly write one `order_pickup_verified` Admin audit entry.
12. Complete the command receipt with HTTP status, code and response data.
13. Commit all writes together.

If the conditional update affects zero rows, reload the order inside the transaction and map the actual current condition to type, state or version conflict. No success receipt or log is committed.

If the receipt insert hits the existing unique constraint, abort that transaction and load the committed receipt outside it. A matching completed receipt may be replayed only after current authorization and data-scope checks. A different hash returns `ADMIN_IDEMPOTENCY_KEY_REUSED`. An incomplete receipt is not treated as success and returns a sanitized retryable conflict/failure according to the established C2-T1 receipt policy.

No advisory locks, `SELECT FOR UPDATE`, database triggers or PostgreSQL-specific production SQL are introduced. The conditional update keeps transactions short and preserves a controlled future MySQL migration path.

## 8. Logging and Atomicity

The pickup executor must use strict audit/event/timeline functions, not `safeRecordBusinessEvent` or `safeRecordOrderTimeline`.

Committed success produces exactly:

- one `Order` versioned state change from `ready` to `picked`;
- one `BusinessEventLog` with `event_type=pickup_verified`;
- one `OrderTimelineLog` with `event_type=pickup_verified`, Admin actor and bounded remark;
- one `AdminAuditLog` with `action=order_pickup_verified`;
- one completed `AdminCommandReceipt`.

Failure in any required log or receipt write rolls back every item above. Logs must not store tokens, cookies, full session data or unbounded request bodies.

## 9. Route and Legacy Service Boundary

The V1 route owns parsing, error mapping and response envelopes. It calls only the new pickup command executor.

The old `pickupVerify()` export in `order-service.ts` is removed once no production caller remains. Pickup mutation must not continue through a second legacy path.

The C2-T1 status parser removes `picked` from its allowed targets. A direct `POST /api/admin/orders/:id/status` request with `next_status=picked` returns `INVALID_ADMIN_ORDER_STATUS_COMMAND` and has zero side effects.

## 10. Admin Client

Update `verifyOrderPickup()` to send:

- the order ID;
- the visible `order.version`;
- one fresh `crypto.randomUUID()` per user action;
- the existing default remark, unless a later UI adds an explicit remark input.

`OrdersTable` renders “核销自提” only when:

```ts
order.pickup_type === 'store' && order.order_status === 'ready'
```

The generic “已自提” button is removed for every order.

On `ADMIN_ORDER_VERSION_CONFLICT`, `ADMIN_PICKUP_TYPE_CONFLICT` or `ADMIN_PICKUP_STATE_CONFLICT`, the page shows a conflict-specific message and refreshes the list from the server. Other errors continue through the shared Admin error boundary. Buttons must prevent accidental duplicate user clicks while the local command is pending, while server idempotency and version checks remain the authoritative protection.

## 11. Verification Strategy

### Parser and Source Contracts

- Valid command and canonical hash.
- Missing, zero, fractional or stale-shape version input.
- Short, oversized, non-ASCII or whitespace-padded idempotency keys.
- Oversized, control-character or whitespace-padded remarks.
- C2-T1 status parser rejects `picked`.
- No production route imports the legacy `pickupVerify()`.
- UI condition exposes only the authorized store-ready action and contains no generic “已自提” action.

### Real PostgreSQL Executor Tests

- Store + `ready` + matching version succeeds.
- Delivery + `ready` is rejected with zero side effects.
- Store + non-`ready` is rejected with zero side effects.
- Stale version is rejected with zero side effects.
- Missing permission and out-of-scope Admin are rejected with zero side effects.
- Two concurrent commands using the same expected version produce one 200 and one 409.
- Same key and command replays the exact saved result with no duplicate side effects.
- Same key with a different target, version or remark returns 409.
- Permission, active account and scope are rechecked before replay.
- Injected business-event, timeline, audit and receipt-completion failures each roll back the order and all related writes.

Fixtures use a unique `GITHUB_RUN_ID` or equivalent suffix and delete receipts, logs and orders deterministically.

### Route Tests

- Full V1 envelopes for malformed JSON, invalid command, 401, 403, 404, each 409 condition and sanitized 500.
- The retired generic `picked` transition returns 400.
- Unexpected permission-query or database errors do not leak internal details.

### Browser Evidence

A real Admin browser session loads an explicit store-ready fixture, sees exactly one “核销自提” action, sends `expected_version` and a fresh idempotency key, receives 200, refreshes, and displays `picked` with the incremented version in server data. A deterministic same-version conflict returns 409 and proves the page refreshes rather than retaining stale state. A delivery fixture never displays the pickup action.

## 12. Capacity, Portability and Operations

- No schema migration is needed; reuse `Order.version` and `AdminCommandReceipt`.
- No long-running database lock is added.
- The transaction performs one conditional order update and a bounded number of indexed inserts.
- The production capacity baseline remains 100 sustained API QPS and 200 QPS short burst on the planned 4-core/8GB deployment, subject to the later formal load gate.
- Prisma connection limits and existing Runner resource bounds remain unchanged.
- New production code avoids PostgreSQL-only SQL so a future MySQL 8.4 LTS migration remains a controlled adapter-and-test exercise rather than a business rewrite.

## 13. Delivery and Merge Gates

Implementation starts from `stable/l50-a3-4-business-base` on `codex/l50-c2-t2-pickup-verification`.

A temporary task-specific workflow may run focused contracts, real PostgreSQL tests, full repository lint/typecheck/test/build, Admin authentication evidence and Playwright. It must use the self-hosted Runner resource bounds already established by C2-T1 and must be deleted after final review.

Merge requires:

- all focused and repository gates green on the exact tested implementation head;
- deterministic PostgreSQL cleanup;
- a complete base-to-head security and atomicity review;
- no Critical, Important or unresolved review finding;
- the final head differing from the tested head only by removal of the temporary workflow;
- exact-head verification before squash merge into `stable/l50-a3-4-business-base`.

## 14. Follow-up Order

1. C2-T3: refund, withdrawal and inventory-adjustment reliable writes.
2. Delivery cancellation application, merchant confirmation and courier interception.
3. C3: cross-module direct-write and data-ownership governance.
4. L50-D: outbox/inbox, retry, dead-letter and fake POS connector.
