# L53-C After-sale Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the first-launch after-sale loop for product issues and eligible delivery-fee refunds without creating a second refund ledger.

**Architecture:** Add one pure policy module as the authoritative boundary for issue types, product-refund caps, and delivery-fee eligibility. Reuse `AfterSaleCase`, the existing split refund fields, reliable admin refund execution, and existing audit/timeline logs. The miniapp submits a product amount; Admin submits explicit product/delivery splits, with delivery defaulting to zero and allowed only for delivery failures.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, React/Ant Design, native WeChat miniapp, Vitest/Node test runner.

## Global Constraints

- Bad fruit, quality, missing and wrong-item cases default to product-only refunds.
- Undelivered, delivery failure, severe delay and whole-order unfulfillable cases are eligible for a delivery-fee refund.
- Eligibility permits but never forces a delivery-fee refund; the merchant chooses and the default is no refund.
- Product and delivery refunds use integer cents, separate caps, and must sum to the approved total.
- The merchant decision, split amounts, operator and reason must be emitted through existing audit records.
- Do not add membership, coupon, reward, payout, tax or WeChat transfer behavior.
- Run focused tests/typechecks during implementation; postpone full container gates until L53 closes.

---

### Task 1: Central after-sale refund policy

**Files:**
- Create: `apps/api/src/modules/after-sale/after-sale-refund-policy.ts`
- Create: `apps/api/src/modules/after-sale/after-sale-refund-policy.test.ts`

**Interfaces:**
- Produces: `isAfterSaleType`, `deliveryRefundEligibility`, and `assertAfterSaleRefundDecision`.
- Consumes literal order remaining product/delivery amounts and the submitted issue type.

- [ ] Write table-driven failing tests for all product and delivery issue types.
- [ ] Run the focused test and confirm the missing module failure.
- [ ] Implement strict type validation, eligibility, split sum, product cap, delivery cap, and ineligible-delivery rejection.
- [ ] Run the focused test and confirm it passes.

### Task 2: User application amount contract

**Files:**
- Modify: `apps/api/src/modules/user-orders/user-order-service.ts`
- Modify: `apps/api/src/modules/after-sale/after-sale-service.ts`
- Modify: `apps/miniapp/pages/after-sales/apply/index.js`
- Modify: `apps/miniapp/pages/after-sales/apply/index.wxml`
- Create: `apps/miniapp/pages/after-sales/apply/refund-model.js`
- Create: `apps/miniapp/pages/after-sales/apply/refund-model.test.cjs`

**Interfaces:**
- Consumes: `requested_product_refund_cents` from the miniapp.
- Produces: persisted requested total/product split, with requested delivery fixed to zero.

- [ ] Write failing model and API policy tests for yuan-to-cent parsing and product caps.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add explicit product amount input and pass the split into `createAfterSaleCase`.
- [ ] Run focused tests and API typecheck.

### Task 3: Merchant review choice and audit

**Files:**
- Modify: `apps/api/src/modules/after-sale/after-sale-service.ts`
- Modify: `apps/api/src/routes/after-sales.ts`
- Modify: `apps/admin/src/features/sales/after-sales/types.ts`
- Modify: `apps/admin/src/features/sales/after-sales/AfterSalesPage.tsx`
- Create: `apps/admin/src/features/sales/after-sales/refund-decision.ts`
- Create: `apps/admin/src/features/sales/after-sales/refund-decision.test.ts`

**Interfaces:**
- Consumes: explicit approved product amount, merchant delivery choice, delivery amount, and audit note.
- Produces: an approved split that the existing reliable refund executor consumes unchanged.

- [ ] Write failing tests proving delivery defaults off and is unavailable for product issues.
- [ ] Run focused tests and confirm expected failures.
- [ ] Enforce the central policy before approval and include the decision in existing log/event/timeline payloads.
- [ ] Expose the eligible-only merchant choice in Admin and require an audit reason.
- [ ] Run focused API/Admin/miniapp tests plus workspace typechecks.
- [ ] Run one PostgreSQL integration verification for L53-C; do not build production containers.

