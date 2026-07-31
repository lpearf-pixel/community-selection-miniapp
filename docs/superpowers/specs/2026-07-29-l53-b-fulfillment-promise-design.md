# L53-B Fulfillment State and Promise Snapshot Design

**Baseline PR:** `codex/l53-first-launch-closure` / PR #119

## Goal

Make local delivery and store pickup operationally explicit before the first production launch. Every new order records the fulfillment promise shown at checkout, and every delivery transition is persisted, validated, versioned, and audited.

## Scope

L53-B includes:

- persisted local-delivery states;
- the existing authenticated pickup verification lifecycle;
- immutable fulfillment-promise snapshots created with the order;
- safe user/admin DTOs and the current admin delivery workbench;
- migration of historical delivery reservations into the new state contract.

It does not include after-sales reason expansion, WeChat shipping synchronization, third-party courier calls, live driver location, automatic payout, or membership/coupon behavior.

## Fulfillment ownership

`Order` remains the source of truth. A second fulfillment aggregate or external delivery table is not introduced for first launch.

Store pickup uses the existing order lifecycle:

- paid/grouped/preparing: preparing for pickup;
- ready: ready for pickup;
- picked: pickup verified;
- refunded/closed: canceled.

Only the existing authenticated, idempotent pickup-verification command may produce `picked`.

Local delivery adds a persisted `DeliveryFulfillmentStatus`:

- `pending_dispatch`;
- `delivering`;
- `delivered`;
- `exception`.

Allowed transitions are:

- `pending_dispatch -> delivering | exception`;
- `delivering -> delivered | exception`;
- `exception -> pending_dispatch | delivering`;
- `delivered` is terminal.

The delivery command rejects store-pickup orders, unpaid or closed orders, stale `expected_version` values, unsupported transitions, reused idempotency keys with different payloads, and missing exception remarks. A successful transition increments `Order.version` and writes the order timeline, business event, admin audit, and command receipt in one transaction.

`delivered` also advances `Order.order_status` to `delivered`. It does not mark the order `completed` or release financial rewards; completion remains a separate observed business transition.

## Promise snapshot

Every new order writes `fulfillment_promise_snapshot` in the same transaction as order creation. The JSON snapshot contains:

- `schema_version: 1`;
- `fulfillment_type: store | delivery`;
- `window_code`;
- `display_text`;
- `promised_start_at`;
- `promised_end_at`;
- `timezone: Asia/Shanghai`;
- `source: delivery_rule | group_buy_pickup | store_confirmation_pending`;
- `source_rule_id` and `source_rule_updated_at` when a stored delivery rule supplied the window;
- `captured_at`.

Queryable `promised_fulfillment_start_at` and `promised_fulfillment_end_at` columns duplicate the absolute boundaries for operations queries. The JSON is the audit snapshot; the columns are indexes/query aids.

Delivery windows gain an optional non-negative `day_offset`. New and edited rules store it explicitly. Historical windows remain readable: `tomorrow_*` maps to `1`, and all other historical codes map to `0`. The selected date is resolved in `Asia/Shanghai`, producing absolute UTC instants without depending on the server timezone.

For group-buy pickup, `GroupBuy.pickup_time` is copied into the snapshot. A normal store-pickup order currently has no configured promise window, so it stores the explicit text `门店确认后通知自提时间`, null absolute bounds, and source `store_confirmation_pending`; no date is invented.

The snapshot is immutable after creation. Delivery transitions, pickup verification, refund processing, and rule edits must not update it.

## Historical migration

The migration adds nullable promise fields so existing orders remain readable. Historical delivery orders receive:

- `pending_dispatch` when active and not fulfilled;
- `delivered` when order status is `delivered` or `completed`;
- `exception` is not inferred without explicit evidence;
- null promise snapshots, exposed as legacy/unavailable rather than fabricated.

The old API values are translated at the boundary for one release:

- `assigned` becomes `delivering`;
- `delivery_failed` becomes `exception`;
- `none` on an active delivery order becomes `pending_dispatch`.

New writes accept only the L53-B four-state contract.

## API and UI

Admin delivery DTOs include `version`, persisted `delivery_status`, promise text/bounds, and allowed next states. Status updates require:

- `delivery_status`;
- `expected_version`;
- `idempotency_key`;
- optional `remark`, required for `exception`.

User order list/detail responses expose the fulfillment status and promise display text/bounds. They continue to mask phone and address data. The miniapp and admin workbench render Chinese labels and never derive a different promise from the current mutable delivery rule.

## Errors

Delivery-command failures use the existing versioned admin error envelope with stable codes for not found, forbidden, pickup-type conflict, payment/state conflict, transition conflict, version conflict, idempotency conflict, and internal failure. All conflicts leave the order, snapshot, timeline, audit log, and receipt result unchanged.

## Testing

- pure unit tests cover promise resolution independently of current rules;
- PostgreSQL integration tests cover transition matrices, stale versions, idempotent replay, rollback, pickup rejection, and snapshot immutability;
- order creation integration coverage verifies delivery, group-buy pickup, and normal pickup snapshots;
- DTO tests verify masked output and legacy fallbacks;
- existing pickup verification tests remain unchanged and must pass;
- Community Runner executes migration, PostgreSQL, lint, typecheck, all tests, builds, and `verify:all`.

## Exit criteria

L53-B is complete when new delivery and pickup orders have honest immutable promise snapshots, delivery state updates are persisted and race-safe, pickup remains command-owned, user/admin views display the stored facts, historical orders remain readable, and the complete production gate passes.
