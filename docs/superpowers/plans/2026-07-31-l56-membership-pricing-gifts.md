# L56 Membership Pricing and Gifts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build auditable annual membership, margin-protected member pricing, and idempotent new-product gift inventory on top of L55 legacy eligibility.

**Architecture:** Keep lifecycle, pricing, and gifts as separate API domain modules. Persist immutable membership periods and pricing snapshots; use serializable transactions for one-time eligibility consumption and inventory reservation. Existing order and fulfillment services consume narrow domain interfaces rather than duplicating rules.

**Tech Stack:** TypeScript, Fastify, Prisma, PostgreSQL, Vitest, pnpm workspace.

## Global Constraints

- All monetary values are integer cents; discount and margin rates are integer basis points.
- `MEMBERSHIP_ENABLED=false` fails closed for activation, member pricing, and gifts.
- No coupon stacking, points, member balance, tiers, auto-renewal, or multi-level referral.
- Historical price snapshots are immutable.
- Legacy activation is one user, one `LEGACY_FIRST_YEAR_FREE`, one 365-day period.
- Gift eligibility and physical inventory are separate; loss/damage never creates sellable stock.

---

### Task 1: Membership lifecycle and legacy activation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202607310001_l56_membership_pricing_gifts/migration.sql`
- Create: `apps/api/src/modules/membership/membership-lifecycle.ts`
- Create: `apps/api/src/modules/membership/membership-lifecycle.test.ts`
- Create: `apps/api/src/modules/membership/membership-repository.ts`
- Create: `apps/api/src/modules/membership/membership-repository.integration.test.ts`

**Interfaces:**
- Produces: `activateLegacyMembership(input, ports): Promise<MembershipActivationResult>` and `getMembershipEntitlement(userId, now): Promise<MemberEntitlement>`.

- [ ] Write failing tests for disabled feature, wrong owner/status, expired membership, idempotent duplicate activation, and 365-day period boundaries.
- [ ] Run the focused tests and verify the missing module/behavior failures.
- [ ] Add membership account/period/idempotency schema and migration.
- [ ] Implement pure lifecycle validation and the serializable Prisma repository transaction.
- [ ] Run focused unit and PostgreSQL integration tests, then commit.

### Task 2: Margin-protected pricing engine and snapshots

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/202607310001_l56_membership_pricing_gifts/migration.sql`
- Create: `apps/api/src/modules/membership/member-pricing.ts`
- Create: `apps/api/src/modules/membership/member-pricing.test.ts`
- Modify: `apps/api/src/modules/order/order-service.ts`
- Test: `apps/api/src/modules/order/order-service.test.ts`

**Interfaces:**
- Consumes: `MemberEntitlement` from Task 1.
- Produces: `quoteMemberPrice(input): MemberPriceQuote` with `priceSource`, `unitPriceCents`, `floorPriceCents`, `marginFloorApplied`, and immutable snapshot fields.

- [ ] Write table-driven failures for 9000/8000 defaults, integer rounding, minimum margin amount/rate, non-member/expired member, invalid basis points, and no stacking.
- [ ] Run the focused test and verify failure.
- [ ] Implement the pure pricing engine and product pricing-rule fields.
- [ ] Persist the quote snapshot on order creation without changing historical orders.
- [ ] Run pricing and order tests, then commit.

### Task 3: Gift entitlement and inventory reservation

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/202607310001_l56_membership_pricing_gifts/migration.sql`
- Create: `apps/api/src/modules/membership/member-gift-service.ts`
- Create: `apps/api/src/modules/membership/member-gift-service.test.ts`
- Create: `apps/api/src/modules/membership/member-gift-repository.ts`
- Create: `apps/api/src/modules/membership/member-gift-repository.integration.test.ts`

**Interfaces:**
- Consumes: active membership period from Task 1.
- Produces: `claimGift`, `releaseUncollectedGift`, `markGiftDelivered`, and `writeOffGiftLoss` commands with idempotent results.

- [ ] Write failing tests for inactive membership, claim limit, insufficient stock, duplicate key, release, delivery, and loss/damage behavior.
- [ ] Run focused tests and verify failure.
- [ ] Add campaign, claim, reservation, and write-off schema.
- [ ] Implement serializable inventory commands and audit records.
- [ ] Run unit and PostgreSQL integration tests, then commit.

### Task 4: API, fulfillment, refund, admin and miniapp integration

**Files:**
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/routes/membership.ts`
- Create: `apps/api/src/routes/membership.test.ts`
- Modify: `apps/api/src/modules/after-sale/after-sale-service.ts`
- Modify: `apps/api/src/modules/delivery/delivery-service.ts`
- Modify: `apps/api/src/modules/order/admin-pickup-verification-executor.ts`
- Create: `apps/admin/src/features/membership/benefits/MemberBenefitsPage.tsx`
- Create: `apps/miniapp/pages/membership/index.{js,json,wxml,wxss}`

**Interfaces:**
- Consumes all Task 1-3 domain commands.
- Produces authenticated membership status/activation/quote/gift endpoints and operational management views.

- [ ] Write failing route and integration tests for identity, feature switch, V1 envelopes, fulfillment transitions, and refund blockers.
- [ ] Implement API routes and wire the domain ports.
- [ ] Add minimal admin and miniapp views using existing design patterns.
- [ ] Run focused API/admin/miniapp tests and update release verification registration.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, migration checks, and the L56 release gate; commit and publish a Draft PR.
