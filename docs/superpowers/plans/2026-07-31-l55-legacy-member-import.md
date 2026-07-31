# L55 Legacy Member Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an audited two-stage CSV/XLSX import that identifies legacy members by privacy-preserving phone fingerprints and grants one idempotent first-year-free eligibility.

**Architecture:** Parsing and phone identity are pure modules. A service owns preview, confirm, claim, and revoke rules through a repository port; Prisma provides the production adapter and transaction boundary. Fastify exposes super-admin-only endpoints, while the Admin page only renders masked values.

**Tech Stack:** TypeScript, Fastify 5, Prisma/PostgreSQL, `@fastify/multipart`, `csv-parse`, `exceljs`, React, Ant Design, Vitest.

## Global Constraints

- Support both CSV and `.xlsx`; normalize them into the same row shape.
- Use HMAC-SHA256 with `MEMBER_PHONE_HMAC_SECRET` of at least 32 characters.
- Never persist or return a full imported phone number.
- Limit files to 5 MiB and data rows to 10,000; reject Excel formulas.
- Only `super_admin` can preview, confirm, list, or revoke.
- Keep `MEMBERSHIP_ENABLED=false` independent from eligibility creation.

---

### Task 1: Phone identity and file parsing

**Files:**
- Create: `apps/api/src/modules/member-import/phone-identity.test.ts`
- Create: `apps/api/src/modules/member-import/phone-identity.ts`
- Create: `apps/api/src/modules/member-import/member-file-parser.test.ts`
- Create: `apps/api/src/modules/member-import/member-file-parser.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `normalizeMainlandPhone(raw): string | null`, `maskPhone(phone): string`, `fingerprintPhone(phone, secret): string`, `parseMemberImportFile(input): Promise<ParsedMemberRow[]>`.

- [ ] Write tests for accepted `+86`/separator forms, rejected invalid numbers, masking, deterministic keyed fingerprints, CSV aliases, first-sheet XLSX, formula rejection, size and row limits.
- [ ] Run both test files and verify they fail because modules are missing.
- [ ] Add pinned parser dependencies and implement the minimum pure modules.
- [ ] Re-run both files and verify all cases pass.

### Task 2: Persistence model and domain service

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202607310001_l55_legacy_member_import/migration.sql`
- Create: `apps/api/src/modules/member-import/member-import-service.test.ts`
- Create: `apps/api/src/modules/member-import/member-import-service.ts`
- Create: `apps/api/src/modules/member-import/member-import-repository.ts`

**Interfaces:**
- Consumes: phone identity and parsed rows from Task 1.
- Produces: `previewImport`, `confirmImport`, `claimLegacyEligibility`, `revokeEligibility`, and a `MemberImportRepository` port with a Prisma adapter.

- [ ] Write repository-port tests for preview counts, within-file duplicates, cross-batch idempotency, existing-user matching, delayed claim, confirm idempotency, and revoke rules.
- [ ] Run the service test and verify missing behavior fails.
- [ ] Add batch, row, and eligibility Prisma models plus indexes/uniques and the equivalent SQL migration.
- [ ] Implement the service and Prisma adapter with transactions and masked-only DTOs.
- [ ] Generate Prisma Client, re-run service tests, typecheck, and statically validate migrations.

### Task 3: Super-admin API and centralized configuration

**Files:**
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/src/index.test.ts`
- Modify: `.env.example`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/routes/admin/index.ts`
- Create: `apps/api/src/routes/admin/member-imports.test.ts`
- Create: `apps/api/src/routes/admin/member-imports.ts`

**Interfaces:**
- Produces: `POST /api/admin/member-imports/preview`, `POST /api/admin/member-imports/:id/confirm`, `GET /api/admin/member-imports`, `GET /api/admin/member-imports/:id`, and `POST /api/admin/member-import-eligibilities/:id/revoke`.

- [ ] Write injection tests for strict super-admin access, multipart upload, V1 errors, masked-only responses, idempotent confirm, and revoke errors.
- [ ] Run tests and verify the routes/config fields are missing.
- [ ] Register multipart with the limits, declare Fastify config augmentation, expose the secret only through `@community-selection/config`, and implement route handlers.
- [ ] Re-run route/config tests and root typecheck.

### Task 4: Admin workbench and release gates

**Files:**
- Modify: `apps/admin/src/app/admin-view.ts`
- Modify: `apps/admin/src/app/feature-registry.ts`
- Modify: `apps/admin/src/app/refresh-policy.ts`
- Modify: `apps/admin/src/app/AdminApp.tsx`
- Create: `apps/admin/src/features/membership/member-imports/api.ts`
- Create: `apps/admin/src/features/membership/member-imports/MemberImportsPage.test.tsx`
- Create: `apps/admin/src/features/membership/member-imports/MemberImportsPage.tsx`
- Create: `docs/reviews/l55-legacy-member-import.md`

**Interfaces:**
- Consumes: Task 3 endpoints and masked DTOs.
- Produces: `memberImports` navigation under “会员与营销”, upload/preview/confirm/history/detail/revoke controls, and a visible disabled-membership notice.

- [ ] Write tests for accepted file types, source requirement, masked rendering, explicit confirmation, eligibility warning, and navigation permission.
- [ ] Run tests and verify the workbench is absent.
- [ ] Implement the API client, workbench, navigation, refresh target, and local error boundary.
- [ ] Run focused API/Admin tests, lint, root typecheck, full tests, build, Prisma generation, and migration check.
- [ ] Record exact results and the PostgreSQL `DATABASE_URL` boundary in the review.
