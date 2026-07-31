# L53 First-Launch Closure Design

**Baseline:** `47093159a5f55801a2c27316c6ca5e25749dcbae`

**Development branch:** `codex/l53-first-launch-closure`

## Goal

Release only the proven purchase, group-buy, delivery/pickup, and after-sales loop. Membership, coupons, cash rewards, withdrawals, and automated payouts remain unavailable until their later release phases pass independent compliance and production gates.

## Scope decomposition

L53 is delivered as four independently reviewable units:

1. **L53-A — first-launch guardrails:** one production mode and fail-closed feature switches for membership, coupons, cash rewards, withdrawals, and payout automation.
2. **L53-B — fulfillment:** delivery lifecycle, pickup lifecycle, exception states, and immutable promised-time snapshots.
3. **L53-C — after-sales:** damaged produce, missing items, wrong items, quality complaints, redelivery, partial refund, and delivery-fee refund.
4. **L53-D — platform/compliance closure:** WeChat order-shipping synchronization, privacy evidence, category/qualification/forbidden-product gates, and production acceptance evidence.

L53 does not implement the L55 membership, L56 member pricing/gifts, L57 coupons, or L58 promoter-partner system.

## Architecture

### First-launch policy

Production uses `FIRST_LAUNCH_MODE=true`. The runtime contract rejects startup unless the following switches are explicitly false:

- `MEMBERSHIP_ENABLED`
- `COUPONS_ENABLED`
- `CASH_REWARDS_ENABLED`
- `WITHDRAWALS_ENABLED`
- `AUTO_PAYOUT_ENABLED`
- `AUTO_TAX_FILING_ENABLED`
- `WECHAT_TRANSFER_ENABLED`
- `WECHAT_MERCHANT_TRANSFER_ENABLED`

The policy is fail-closed: missing or true high-risk switches stop production startup. Hiding a miniapp entry is defense in depth, not the authorization boundary. API reads and writes for disabled capabilities must also return a stable unavailable response.

### Fulfillment state

Delivery and pickup remain separate fulfillment modes. Each order stores an immutable snapshot of the promised fulfillment window at checkout. Delivery transitions are `pending -> dispatching -> delivered`, with an explicit `exception` branch. Pickup completes only through the existing authenticated verification command.

### After-sales

After-sales reasons are typed and auditable. Financial corrections use existing refund commands and integer cents. Redelivery and refund are separate resolutions. A refund may include eligible item amounts and an explicitly recorded delivery-fee component, never an inferred total.

### WeChat shipping synchronization

Internal fulfillment is authoritative. Each relevant transition writes an idempotent synchronization intent. Retries may repeat transport calls but may not duplicate business events. Pickup, local delivery, and no-logistics orders map to their platform-supported shipping types; no universal tracking-number requirement is introduced.

### Compliance evidence

Release gates verify configuration and repository contracts automatically. Human evidence is recorded without secrets or full personal data. Qualification, privacy, product-category, forbidden-product, delivery, pickup, and after-sales checks must all be complete before production expansion.

## Error handling

- Unsafe production configuration aborts before the API serves traffic.
- Disabled capabilities fail closed in the API and remain hidden in the miniapp.
- Unknown fulfillment transitions return versioned 4xx envelopes and leave state unchanged.
- WeChat synchronization uncertainty is recorded for retry and review; it never rolls back a valid internal fulfillment transition.
- Refund uncertainty uses existing idempotent command and reconciliation behavior.

## Testing

Every behavior follows red-green TDD. L53-A starts with configuration tests that fail because the first-launch contract is absent, then adds the minimum runtime implementation. Later units use integration tests on PostgreSQL, miniapp model tests, workflow contract tests, and real-production acceptance cases.

## Release criteria

L53 exits only when:

- first-launch production startup rejects every prohibited capability;
- purchase and group-buy behavior remains available;
- delivery, pickup, and after-sales transitions have automated coverage;
- WeChat shipping synchronization is idempotent and observable;
- privacy, qualification, category, and forbidden-product gates pass;
- real acceptance evidence covers purchase, group-buy, delivery, pickup, after-sales, backup, restore, and rollback.
