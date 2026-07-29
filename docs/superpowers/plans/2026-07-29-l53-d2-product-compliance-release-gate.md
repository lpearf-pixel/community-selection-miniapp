# L53-D2 Product Compliance Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a traceable supplier, qualification, batch-evidence, product-approval, and fail-closed production release gate for the five approved first-launch categories.

**Architecture:** Extend the existing modular monolith and the current `Supplier`, `ProductBatch`, `Product`, `Category`, `AdminAuditLog`, and `OpsAlertLog` models. Pure versioned rule and fingerprint modules feed transactional admin commands; a read-only release evaluator dynamically validates every active product and emits sanitized JSON evidence.

**Tech Stack:** Node.js 20.19, TypeScript, Fastify, Prisma, PostgreSQL, Vitest, React/Vite/Ant Design, pnpm workspace, GitHub Actions self-hosted `community` Runner.

## Global Constraints

- Only `vegetable`, `fruit`, `egg`, `grain`, and `primary_dried_goods` are production-eligible.
- Existing active products must not be automatically deactivated.
- Missing database state, rules, approval, or evidence must fail closed.
- The same administrator may submit and review, but submission and review are separate commands.
- Qualification and approval history is immutable; replacements create new rows.
- Price, inventory, sales, sorting, and ordinary promotion state do not enter the compliance fingerprint.
- Sensitive document contents, identity numbers, phone numbers, storage signatures, and raw object URLs never enter logs or release evidence.
- Production CI uses `runs-on: [self-hosted, community]`; do not use `community-w01`.
- Do not add Redis, MQ, microservices, automatic delisting, OCR, e-invoicing, or general-taxpayer accounting.
- Preserve integer-cent money storage and the existing V1 API envelope conventions.
- Follow RED → verify RED → GREEN → verify GREEN for every behavior change.

---

## File Structure

### Rules and fingerprints

- Create `apps/api/src/modules/compliance/first-launch-category-rules.ts`: versioned allowlist and category decision.
- Create `apps/api/src/modules/compliance/first-launch-category-rules.test.ts`: allow/deny/fail-closed tests.
- Create `apps/api/src/modules/compliance/product-compliance-fingerprint.ts`: canonical input and SHA-256.
- Create `apps/api/src/modules/compliance/product-compliance-fingerprint.test.ts`: included/excluded field tests.

### Persistence and commands

- Modify `prisma/schema.prisma`: extend existing models and add qualification, batch evidence, approval, and access-audit models.
- Create `prisma/migrations/202607290002_l53_d2_product_compliance/migration.sql`: additive PostgreSQL migration.
- Create `apps/api/src/modules/compliance/supplier-qualification-command.ts` and test.
- Create `apps/api/src/modules/compliance/supplier-qualification-executor.ts` and PostgreSQL integration test.
- Create `apps/api/src/modules/compliance/product-compliance-command.ts` and test.
- Create `apps/api/src/modules/compliance/product-compliance-executor.ts` and PostgreSQL integration test.
- Modify `apps/api/src/modules/supplier/supplier-service.ts` and `apps/api/src/routes/suppliers.ts`: subject profile and qualification endpoints.
- Create `apps/api/src/routes/admin/compliance.ts`: product submit/review and evidence access-audit endpoints.
- Modify `apps/api/src/routes/admin/index.ts`: register compliance routes.
- Modify `apps/api/src/modules/inventory/purchase-batch-owner.ts`: persist traceability/evidence references without taking ownership of other tables.

### Release evaluation

- Create `apps/api/src/modules/compliance/compliance-release-evaluator.ts` and test.
- Create `apps/api/src/modules/compliance/compliance-release-evaluator.integration.test.ts`.
- Create `scripts/verify-l53-d2-compliance-release-local.ts`: generate sanitized JSON and non-zero exit on failure.
- Modify `scripts/verification-baseline-manifest.ts` and `scripts/verify-all-local.sh`: register D2 without deleting old gates.
- Create `.github/workflows/l53-d2-compliance-gate.yml`: focused PostgreSQL gate on `community`.

### Admin

- Modify `apps/admin/src/features/inventory/shared/types.ts`: subject, qualification, batch evidence, and review DTOs.
- Modify `apps/admin/src/features/supply/suppliers/api.ts`: profile/qualification commands.
- Modify `apps/admin/src/features/supply/suppliers/SuppliersPage.tsx`: subject and qualification status UI.
- Create `apps/admin/src/features/catalog/compliance/api.ts`, `api.test.ts`, and `ProductCompliancePanel.tsx`.
- Modify `apps/admin/src/features/catalog/products/CatalogProductsPage.tsx`: mount the panel without replacing product status controls.

---

### Task 1: Versioned Category Policy and Deterministic Fingerprint

**Files:**
- Create: `apps/api/src/modules/compliance/first-launch-category-rules.test.ts`
- Create: `apps/api/src/modules/compliance/first-launch-category-rules.ts`
- Create: `apps/api/src/modules/compliance/product-compliance-fingerprint.test.ts`
- Create: `apps/api/src/modules/compliance/product-compliance-fingerprint.ts`

**Interfaces:**
- Produces: `FIRST_LAUNCH_CATEGORY_RULE_VERSION`, `decideFirstLaunchCategory(code)`
- Produces: `PRODUCT_COMPLIANCE_FINGERPRINT_VERSION`, `buildProductComplianceFingerprint(input)`
- Consumes: only Node `crypto`; no Prisma or Fastify dependency.

- [ ] **Step 1: Write the category RED tests**

```ts
expect(decideFirstLaunchCategory('vegetable')).toEqual({ allowed: true, reason: null });
expect(decideFirstLaunchCategory('prepackaged_food')).toEqual({
  allowed: false,
  reason: 'CATEGORY_NOT_ALLOWED',
});
expect(decideFirstLaunchCategory(null)).toEqual({
  allowed: false,
  reason: 'CATEGORY_CODE_MISSING',
});
```

- [ ] **Step 2: Run category tests and verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/compliance/first-launch-category-rules.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the immutable policy**

```ts
export const FIRST_LAUNCH_CATEGORY_RULE_VERSION = 'l53-d2-category-v1';
const ALLOWED = new Set([
  'vegetable',
  'fruit',
  'egg',
  'grain',
  'primary_dried_goods',
] as const);

export function decideFirstLaunchCategory(code: string | null | undefined) {
  if (!code?.trim()) return { allowed: false as const, reason: 'CATEGORY_CODE_MISSING' as const };
  return ALLOWED.has(code as never)
    ? { allowed: true as const, reason: null }
    : { allowed: false as const, reason: 'CATEGORY_NOT_ALLOWED' as const };
}
```

- [ ] **Step 4: Write fingerprint RED tests**

Assert that changing name, description, category code, supplier, origin, qualification hashes, batch evidence hashes, labels, cover image, or images changes the digest. Assert that changing price, cost, stock, sales, sort order, or promotion state does not change it. Assert reordered evidence arrays produce the same digest.

- [ ] **Step 5: Run fingerprint tests and verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/compliance/product-compliance-fingerprint.test.ts
```

Expected: FAIL because the fingerprint module does not exist.

- [ ] **Step 6: Implement canonical JSON and SHA-256**

```ts
export type ProductComplianceFingerprintInput = {
  name: string;
  description: string | null;
  category_code: string | null;
  supplier_id: string | null;
  origin_text: string | null;
  qualification_hashes: string[];
  batch_evidence_hashes: string[];
  labels: string[];
  cover_image: string | null;
  images: string[];
};

export function buildProductComplianceFingerprint(input: ProductComplianceFingerprintInput) {
  const canonical = {
    version: PRODUCT_COMPLIANCE_FINGERPRINT_VERSION,
    ...input,
    qualification_hashes: [...input.qualification_hashes].sort(),
    batch_evidence_hashes: [...input.batch_evidence_hashes].sort(),
    labels: [...input.labels].sort(),
    images: [...input.images].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

- [ ] **Step 7: Verify GREEN and commit**

Run both test files, then:

```bash
git add apps/api/src/modules/compliance
git commit -m "feat(l53): add versioned compliance rules and fingerprint"
```

---

### Task 2: Additive Compliance Schema and Migration Contract

**Files:**
- Create: `apps/api/src/modules/compliance/compliance-schema.contract.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202607290002_l53_d2_product_compliance/migration.sql`

**Interfaces:**
- Produces Prisma models: `SupplierQualification`, `ProductBatchEvidence`, `ProductComplianceReview`, `ComplianceEvidenceAccessLog`
- Extends: `Category.compliance_code`, `Product.primary_supplier_id`, `Product.origin_text`, `Product.labels`
- Extends: `Supplier.subject_type`, `Supplier.source_address`, `Supplier.market_name`, `Supplier.stall_no`, `Supplier.profile_fingerprint`, `Supplier.profile_version`
- Extends: `ProductBatch.origin_text`, `ProductBatchEvidence` relation.

- [ ] **Step 1: Write a schema contract that fails before migration**

The test must require:

```ts
for (const token of [
  'compliance_code',
  'primary_supplier_id',
  'model SupplierQualification',
  'model ProductBatchEvidence',
  'model ProductComplianceReview',
  'model ComplianceEvidenceAccessLog',
  '@@index([product_id, status, created_at])',
]) expect(schema).toContain(token);
```

It must also assert the migration contains no `DROP TABLE`, `DROP COLUMN`, mass `UPDATE "Product" SET "status"`, or fabricated approval insert.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/compliance/compliance-schema.contract.test.ts
```

Expected: FAIL for missing schema fields and migration.

- [ ] **Step 3: Add models with immutable snapshots**

Use string status fields to match the existing supplier/inventory subsystem. Required columns:

```prisma
model ProductComplianceReview {
  id                         String   @id @default(cuid())
  product_id                 String
  status                     String
  compliance_fingerprint     String
  fingerprint_version        String
  category_rule_version      String
  qualification_rule_version String
  product_snapshot           Json
  supplier_snapshot          Json
  qualification_snapshot     Json
  batch_evidence_snapshot    Json
  submitted_by_admin_id      String
  submitted_at               DateTime
  reviewed_by_admin_id       String?
  reviewed_at                DateTime?
  review_note                String?
  invalidated_at             DateTime?
  invalidation_reason        String?
  created_at                 DateTime @default(now())
  product                    Product  @relation(fields: [product_id], references: [id])

  @@index([product_id, status, created_at])
  @@index([compliance_fingerprint])
}
```

Store document object references only in `SupplierQualification` and `ProductBatchEvidence`; snapshots contain IDs, hashes, types, dates, and masked summaries only.

- [ ] **Step 4: Write the additive SQL migration**

Add nullable columns to existing rows. Create new tables and indexes. Use `ON DELETE RESTRICT` for historical evidence/reviews and do not backfill approvals.

- [ ] **Step 5: Verify schema and migration GREEN**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/compliance/compliance-schema.contract.test.ts
pnpm exec prisma validate
pnpm exec tsx scripts/verify-migration-safety.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add prisma apps/api/src/modules/compliance/compliance-schema.contract.test.ts
git commit -m "feat(l53): add additive compliance evidence schema"
```

---

### Task 3: Supplier Subject and Qualification Commands

**Files:**
- Create: `apps/api/src/modules/compliance/supplier-qualification-command.test.ts`
- Create: `apps/api/src/modules/compliance/supplier-qualification-command.ts`
- Create: `apps/api/src/modules/compliance/supplier-qualification-executor.integration.test.ts`
- Create: `apps/api/src/modules/compliance/supplier-qualification-executor.ts`
- Modify: `apps/api/src/modules/supplier/supplier-service.ts`
- Modify: `apps/api/src/routes/suppliers.ts`

**Interfaces:**
- Produces: `parseSubmitSupplierQualificationCommand`
- Produces: `executeSubmitSupplierQualification`, `executeReviewSupplierQualification`, `executeRevokeSupplierQualification`
- Commands require `idempotency_key`; review requires `expected_status: 'submitted'`.
- Uses existing `AdminCommandReceipt` and `recordAdminAudit`.

- [ ] **Step 1: RED unit tests for validation and privacy**

Cover allowed subject types, required natural-person production address, market/stall pairing, 64-character lowercase SHA-256, non-public object key, valid date order, mandatory review note, and rejection of raw document bodies/data URLs.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @community-selection/api test -- src/modules/compliance/supplier-qualification-command.test.ts
```

Expected: FAIL because parsers do not exist.

- [ ] **Step 3: Implement strict parsers**

The submit command returns only:

```ts
type SubmitSupplierQualificationCommand = {
  qualification_type: string;
  object_key: string;
  file_sha256: string;
  issued_at: Date | null;
  valid_from: Date | null;
  expires_at: Date | null;
  masked_summary: Record<string, string>;
  idempotency_key: string;
};
```

Reject keys beginning with `http://`, `https://`, `data:`, or containing query signatures.

- [ ] **Step 4: RED PostgreSQL tests**

Prove submit creates `submitted` plus audit and receipt atomically; approve/reject are separate commands; same administrator may perform both; replace creates a new row; revoke never mutates snapshots; rollback injection leaves no partial writes.

- [ ] **Step 5: Implement transactional executors and routes**

Endpoints:

```text
POST /api/admin/suppliers/:id/qualifications/submit
POST /api/admin/supplier-qualifications/:id/review
POST /api/admin/supplier-qualifications/:id/revoke
```

Return sanitized DTOs without `object_key`. Route responses use V1 envelopes and stable error codes.

- [ ] **Step 6: Verify GREEN**

Run unit tests, PostgreSQL integration tests, API typecheck, and existing L14 supplier verification.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/compliance apps/api/src/modules/supplier apps/api/src/routes/suppliers.ts
git commit -m "feat(l53): add supplier qualification workflow"
```

---

### Task 4: Batch Traceability and Purchase Evidence

**Files:**
- Create: `apps/api/src/modules/compliance/product-batch-evidence.test.ts`
- Create: `apps/api/src/modules/compliance/product-batch-evidence.ts`
- Modify: `apps/api/src/modules/inventory/purchase-batch-owner.test.ts`
- Modify: `apps/api/src/modules/inventory/purchase-batch-owner.ts`
- Modify: `apps/api/src/modules/purchase/admin-purchase-receive-command.ts`
- Modify: `apps/api/src/modules/purchase/admin-purchase-receive-command.test.ts`

**Interfaces:**
- Produces: `validateProductBatchEvidence(input)`
- Extends receipt item with `origin_text`, `purchase_voucher_type`, `payment_reference_hash`, `invoice_evidence_status`, and evidence ID/hash arrays.
- `createPurchaseBatch` remains owner of `ProductBatch` and `BatchStockLedger`; evidence helper owns only `ProductBatchEvidence`.

- [ ] **Step 1: RED tests for minimum evidence by supplier type**

Natural-person producer requires identity/profile completeness, origin, payment reference, and batch proof. Company/cooperative/individual business requires an active qualification plus purchase evidence. Temporary sources always fail product-approval eligibility.

- [ ] **Step 2: Verify RED**

Run the two focused test files and confirm expected validation failures.

- [ ] **Step 3: Implement validation and batch evidence persistence**

Persist hashes, types, masked summaries, and controlled object references. Never copy raw evidence into `ProductBatch.payload` or `BatchStockLedger.payload`.

- [ ] **Step 4: Verify GREEN and existing purchase ownership**

Run:

```bash
pnpm --filter @community-selection/api test --   src/modules/compliance/product-batch-evidence.test.ts   src/modules/inventory/purchase-batch-owner.test.ts   src/modules/purchase/admin-purchase-receive-command.test.ts   src/modules/purchase/purchase-domain-ownership.contract.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/compliance apps/api/src/modules/inventory apps/api/src/modules/purchase
git commit -m "feat(l53): persist batch traceability evidence"
```

---

### Task 5: Product Submit/Review Workflow and Dynamic Invalidation

**Files:**
- Create: `apps/api/src/modules/compliance/product-compliance-command.test.ts`
- Create: `apps/api/src/modules/compliance/product-compliance-command.ts`
- Create: `apps/api/src/modules/compliance/product-compliance-executor.integration.test.ts`
- Create: `apps/api/src/modules/compliance/product-compliance-executor.ts`
- Create: `apps/api/src/routes/admin/compliance.ts`
- Modify: `apps/api/src/routes/admin/index.ts`

**Interfaces:**
- Produces: `executeSubmitProductCompliance`, `executeReviewProductCompliance`
- Produces: `loadCurrentComplianceFacts(tx, productId)`
- Submit creates immutable snapshots and fingerprint; approve/reject updates only decision fields.
- Effective validity is computed from current facts and never trusts stored `status = approved` alone.

- [ ] **Step 1: RED parser tests**

Require expected product update timestamp or expected fingerprint, idempotency key, non-empty review note, and explicit `approve|reject`. Reject any `auto_approve` or combined submit/review payload.

- [ ] **Step 2: RED PostgreSQL lifecycle tests**

Cover:

- same-admin two-action approval succeeds;
- submit alone is not production-valid;
- missing category/supplier/qualification/batch evidence rejects submission;
- changing name, description, category, supplier, origin, qualification hash, evidence hash, label, cover, or images invalidates approval;
- changing price or stock preserves approval;
- expired/revoked qualification and inactive supplier invalidate approval;
- concurrent review accepts one expected submitted state;
- rollback injection removes partial review/audit/receipt writes.

- [ ] **Step 3: Implement current-fact loader and snapshot builder**

Select only required columns. Snapshot arrays use stable sorting. The returned admin DTO includes reason codes and hashes but no object references or raw personal data.

- [ ] **Step 4: Implement routes**

```text
GET  /api/admin/products/:id/compliance
POST /api/admin/products/:id/compliance/submit
POST /api/admin/product-compliance-reviews/:id/review
```

Use existing admin permission and V1 command conventions. Do not add a bypass endpoint.

- [ ] **Step 5: Verify GREEN**

Run all compliance unit/integration tests, API typecheck, and `pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/compliance apps/api/src/routes/admin
git commit -m "feat(l53): add explicit product compliance review"
```

---

### Task 6: Fail-Closed Release Evaluator, Evidence, and Alert

**Files:**
- Create: `apps/api/src/modules/compliance/compliance-release-evaluator.test.ts`
- Create: `apps/api/src/modules/compliance/compliance-release-evaluator.ts`
- Create: `apps/api/src/modules/compliance/compliance-release-evaluator.integration.test.ts`
- Create: `scripts/verify-l53-d2-compliance-release-local.ts`
- Modify: `scripts/verification-baseline-manifest.ts`
- Modify: `scripts/verify-all-local.sh`

**Interfaces:**
- Produces: `evaluateComplianceRelease(prisma, { gitSha, checkedAt })`
- Returns `{ passed, summary, products, rule_versions }` with stable reason codes.
- CLI writes `.github/l53-d2-compliance-evidence.json` and exits 1 on failure.

- [ ] **Step 1: RED evaluator tests**

Create active/draft/inactive fixtures and assert only active products are gated. Prove every approved reason code, rule version, current/approved fingerprint, count, Git SHA, and timestamp is emitted. Prove output JSON contains none of the seeded phone, identity, object key, or signed URL values.

- [ ] **Step 2: Verify RED**

Run focused evaluator tests; expect missing module/script failure.

- [ ] **Step 3: Implement evaluator with dynamic validity**

For each active product, load the latest approved review and current facts, then emit all applicable reasons in stable sorted order. Catch top-level evaluation errors and return `EVIDENCE_GENERATION_FAILED`; the CLI must still exit non-zero.

- [ ] **Step 4: Add deduplicated critical alert**

Use `OpsAlertLog` with:

```ts
{
  alert_type: 'l53_d2_compliance_release_blocked',
  alert_level: 'critical',
  dedupe_key: `l53-d2:${categoryRuleVersion}:${failureDigest}`,
  title: '生产发布被商品合规门禁阻止',
  payload: { product_ids, reason_codes, rule_versions }
}
```

Do not include names, phones, document references, or snapshots in the alert.

- [ ] **Step 5: Register, verify GREEN, and commit**

Run the evaluator tests, the script against passing/failing PostgreSQL fixtures, baseline manifest tests, and typecheck.

```bash
git add apps/api/src/modules/compliance scripts
git commit -m "feat(l53): add fail-closed compliance release evidence"
```

---

### Task 7: Admin Compliance Workbench and Access Audit

**Files:**
- Modify: `apps/admin/src/features/inventory/shared/types.ts`
- Modify: `apps/admin/src/features/supply/suppliers/api.ts`
- Modify: `apps/admin/src/features/supply/suppliers/SuppliersPage.tsx`
- Create: `apps/admin/src/features/catalog/compliance/api.test.ts`
- Create: `apps/admin/src/features/catalog/compliance/api.ts`
- Create: `apps/admin/src/features/catalog/compliance/ProductCompliancePanel.tsx`
- Create: `apps/admin/src/features/catalog/compliance/product-compliance-panel.test.tsx`
- Modify: `apps/admin/src/features/catalog/products/CatalogProductsPage.tsx`
- Modify: `apps/api/src/routes/admin/compliance.ts`

**Interfaces:**
- Admin panel consumes sanitized compliance DTOs only.
- Evidence access endpoint records `ComplianceEvidenceAccessLog` before returning a short-lived adapter result.
- Until an object-storage adapter is configured, evidence access returns `EVIDENCE_DOWNLOAD_UNAVAILABLE` after recording the denied attempt; it never exposes `object_key`.

- [ ] **Step 1: RED API and panel tests**

Assert exact request paths/payloads; separate submit and review buttons; visible invalidation reasons; no automatic approval; masked evidence fields; no raw URL rendering; prices and stock edits do not silently resubmit.

- [ ] **Step 2: Verify RED**

Run focused Admin tests and confirm missing modules/components.

- [ ] **Step 3: Implement minimal workbench**

Show supplier subject type, source completeness, qualification status/expiry, product current fingerprint, latest review status, and failure reasons. Keep existing product status controls unchanged. Require confirmation and a non-empty review note.

- [ ] **Step 4: Implement audited evidence-access boundary**

Record administrator, evidence type/ID, purpose, IP, user-agent, outcome, and timestamp. Return no document content in D2 without the controlled storage adapter.

- [ ] **Step 5: Verify GREEN and commit**

Run Admin focused tests, typecheck, browser contract/smoke, and API access-audit integration test.

```bash
git add apps/admin/src apps/api/src/routes/admin/compliance.ts
git commit -m "feat(l53): add compliance admin workbench"
```

---

### Task 8: Focused PostgreSQL Gate and Release Documentation

**Files:**
- Create: `.github/workflows/l53-d2-compliance-gate.yml`
- Modify: `docs/superpowers/specs/2026-07-29-l53-d2-product-compliance-release-gate-design.md`
- Modify: PR #119 body/comment with RED/GREEN and run evidence.

**Interfaces:**
- Workflow produces `l53-d2-compliance-evidence` artifact.
- Workflow never uses `community-w01`.
- Workflow does not run browser or full production-image gates; those remain L53 final-closure work.

- [ ] **Step 1: Write workflow contract RED test**

Add a static test requiring:

```yaml
runs-on: [self-hosted, community]
```

and rejecting `community-w01`, `continue-on-error: true`, and missing evidence upload.

- [ ] **Step 2: Verify RED**

Run the static workflow contract; expect missing workflow failure.

- [ ] **Step 3: Implement focused workflow**

Steps:

1. checkout;
2. pnpm setup and Node 20.19;
3. install frozen dependencies;
4. generate Prisma client;
5. start isolated PostgreSQL;
6. deploy migrations;
7. run compliance unit and PostgreSQL integration tests;
8. run API/Admin typechecks;
9. run `verify-l53-d2-compliance-release-local.ts`;
10. upload sanitized evidence with `if: always()`;
11. clean PostgreSQL.

- [ ] **Step 4: Run local completion verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:all
```

Record exact pass/fail counts. Do not claim success for any command not actually run.

- [ ] **Step 5: Push and observe the focused gate**

Confirm the job is assigned to `home-community-runner`, then wait for PostgreSQL migration, compliance tests, and evidence generation. If an unrelated historical gate fails, report it separately and do not relabel it as a D2 failure.

- [ ] **Step 6: Update PR evidence and commit documentation**

Include commits, RED evidence, GREEN evidence, migration result, focused run URL, artifact name, remaining L53 final-closure gates, and any residual risk.

```bash
git add .github/workflows/l53-d2-compliance-gate.yml docs
git commit -m "ci(l53): gate D2 compliance release on community runner"
```

---

## Self-Review Result

- Spec coverage: all ten approved D2 sections map to Tasks 1–8.
- Existing data preservation: Task 2 is additive and forbids product status backfill.
- Non-standard suppliers: Tasks 3–4 distinguish subject type from evidence completeness.
- Two-action approval: Tasks 3 and 5 require separate submit/review commands.
- Dynamic invalidation: Tasks 5–6 evaluate current facts, so expiry and edits fail closed without relying on a scheduler.
- Privacy: Tasks 3, 6, and 7 prevent raw evidence from APIs, logs, alerts, and CI artifacts.
- Financial evolution: Task 4 persists supplier, purchase, payment, and invoice-evidence status without implementing invoicing.
- Runner constraint: Task 8 fixes `community` and rejects `community-w01`.
- Placeholder scan: no implementation step depends on unspecified behavior.
