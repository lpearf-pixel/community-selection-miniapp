# Centralized Runtime Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep PostgreSQL and later external-service settings behind one versioned configuration contract so workflows and application code do not invent addresses or connection strings.

**Architecture:** Environment-specific files own non-secret values and secret stores own secret values. `@community-selection/config` validates application runtime values. A repository-local composite action loads the CI PostgreSQL profile and emits the one derived `DATABASE_URL`; workflows consume the action without composing URLs.

**Tech Stack:** GitHub Actions composite actions, Bash, Node.js, TypeScript, Vitest.

## Global Constraints

- Production secrets are never committed.
- Local, CI, and production use the same variable names.
- Business modules do not read database connection variables directly.
- A PostgreSQL URL is derived in one environment adapter, then validated before use.
- Existing fail-closed release gates remain strict.

---

### Task 1: Protect the configuration ownership contract

**Files:**
- Modify: `scripts/production/l53-d2-compliance-gate-contract.test.cjs`
- Modify: `scripts/verification-audit/runner.test.cjs`

**Interfaces:**
- Consumes: current CI workflows.
- Produces: static assertions requiring the shared CI PostgreSQL action and forbidding inline PostgreSQL URLs.

- [ ] **Step 1: Write failing assertions**

Require `uses: ./.github/actions/configure-ci-postgres` and reject inline `DATABASE_URL=postgresql://` in workflows.

- [ ] **Step 2: Run the assertions and verify RED**

Run: `node --test scripts/production/l53-d2-compliance-gate-contract.test.cjs scripts/verification-audit/runner.test.cjs`

Expected: FAIL because current workflows still compose PostgreSQL URLs inline.

### Task 2: Add the shared CI PostgreSQL profile

**Files:**
- Create: `.github/config/ci-postgres.env`
- Create: `.github/actions/configure-ci-postgres/action.yml`

**Interfaces:**
- Consumes: versioned non-secret CI PostgreSQL profile.
- Produces: `POSTGRES_HOST_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `DATABASE_URL` through `GITHUB_ENV`.

- [ ] **Step 1: Add the non-secret CI profile**

Store host, user, password, database, and schema once. These credentials are isolated CI-only values.

- [ ] **Step 2: Add the composite action**

Validate the profile, select an available loopback port, URL-encode credentials, and emit the derived connection URL without printing it.

### Task 3: Migrate every PostgreSQL-backed release workflow

**Files:**
- Modify: `.github/workflows/l50-c2-t3a-refund-gate.yml`
- Modify: `.github/workflows/l50-c2-t3c-inventory-adjust-gate.yml`
- Modify: `.github/workflows/l51-wechat-commerce-gate.yml`
- Modify: `.github/workflows/l52-production-readiness.yml`
- Modify: `.github/workflows/l53-d2-compliance-gate.yml`
- Modify: `.github/workflows/verification-baseline-audit.yml`

**Interfaces:**
- Consumes: `./.github/actions/configure-ci-postgres`.
- Produces: identical workflow environment variables without inline addresses or credentials.

- [ ] **Step 1: Replace inline shell blocks**

Each workflow calls the shared action after Node setup.

- [ ] **Step 2: Include shared configuration paths in filtered workflows**

Changes to the action or profile must retrigger every affected gate.

- [ ] **Step 3: Run the ownership assertions and verify GREEN**

Run: `node --test scripts/production/l53-d2-compliance-gate-contract.test.cjs scripts/verification-audit/runner.test.cjs`

Expected: PASS.

### Task 4: Verify the release gates

**Files:**
- Modify: `docs/superpowers/plans/2026-07-30-centralized-runtime-configuration.md`

**Interfaces:**
- Consumes: the migrated workflows.
- Produces: CI evidence for L51, L52, Baseline, refund, inventory, and L53-D2.

- [ ] **Step 1: Confirm branch diff scope**

No business source or production secret may be present.

- [ ] **Step 2: Observe all affected GitHub Actions runs**

Every PostgreSQL-backed gate must start, migrate, and test using the generated configuration.

- [ ] **Step 3: Record final run evidence**

Update the PR only with completed, real run results.
