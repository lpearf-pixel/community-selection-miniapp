# Verification Baseline Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect every base-verification result in one Runner execution, batch-repair the complete failure set, and restore a green base before PR #105 is tested again.

**Architecture:** Keep `pnpm verify:all` fail-fast as the release gate. Add a separate sequential audit runner that consumes the existing stage registry, continues after check failures, writes isolated logs plus JSON/Markdown observations, and uses report-only mode only in the diagnostic workflow.

**Tech Stack:** Node.js 20, TypeScript/tsx, Node test runner, pnpm, PostgreSQL, GitHub Actions.

## Global Constraints

- Base branch: `stable/l50-a3-4-business-base` at `1b357471cb1691dc81bfad3caefeeca4ecb867d0`.
- Do not change production behavior to satisfy historical verifiers.
- Do not weaken compliance, authorization, migration or refund safety contracts.
- Do not rerun PR #105 until the base is green.
- Preserve one log and one terminal observation for every audit check.

---

### Task 1: Audit runner contract

**Files:**
- Create: `scripts/verification-audit/runner.test.cjs`
- Create: `scripts/lib/verification-audit.cjs`

**Interfaces:**
- Consumes: ordered `{ id, title, layer, command }` records.
- Produces: `runVerificationAudit(options)`, `auditExitCode(report, options)`, `summary.json`, `summary.md`, and per-check logs.

- [ ] Write a failing Node test proving a failed middle check does not prevent the last check.
- [ ] Run `node --test scripts/verification-audit/runner.test.cjs`; expect module-not-found RED.
- [ ] Implement the minimal sequential collector, stable file naming and reports.
- [ ] Rerun the targeted test; expect all assertions to pass.

### Task 2: Complete manifest and diagnostic workflow

**Files:**
- Create: `scripts/verification-baseline-manifest.ts`
- Create: `scripts/verify-baseline-audit-local.ts`
- Create: `.github/workflows/verification-baseline-audit.yml`

**Interfaces:**
- Consumes: `GLOBAL_STATIC_VERIFIERS` and `STAGE_REGISTRY`.
- Produces: one independently recorded check for foundation, L10–L23, L24–L47 and L49.

- [ ] Build the manifest from the existing registry for L24–L47 and explicit legacy checks.
- [ ] Reject duplicate IDs before command execution.
- [ ] Run the targeted collector test.
- [ ] Let the dedicated workflow run the complete audit once with `--report-only`.
- [ ] Upload the report and logs even when repository checks fail.

### Task 3: One-pass classification

**Files:**
- Update: GitHub issue for verification baseline recovery.
- Read: audit `summary.json` and failed per-check logs.

**Interfaces:**
- Consumes: complete observations.
- Produces: reviewed batches labeled production regression, test drift, environment failure or cascade.

- [ ] Verify recorded check count equals manifest check count.
- [ ] Group all failures by root cause rather than discovery order.
- [ ] Record supporting and contradicting evidence for ambiguous failures.
- [ ] Approve only batch-level repairs with explicit rollback boundaries.

### Task 4: Batch recovery and release gate

**Files:**
- Modify only files named by the reviewed batches.
- Preserve: `scripts/verify-all-local.sh` fail-fast behavior.

**Interfaces:**
- Consumes: classified repair batches.
- Produces: green audit, green `pnpm verify:all`, and a recoverable infrastructure PR.

- [ ] Add a RED contract for each root-cause class.
- [ ] Implement the smallest batch repair for that class.
- [ ] Run the audit once after all approved batches are applied.
- [ ] Run `pnpm verify:all` once as the release proof.
- [ ] Merge the base recovery before updating PR #105.
- [ ] Synchronize PR #105 and run its complete CI plus Admin browser gate once.
