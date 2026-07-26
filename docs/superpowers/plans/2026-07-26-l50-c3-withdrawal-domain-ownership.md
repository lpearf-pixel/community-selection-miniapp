# L50-C3 Withdrawal Domain Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish L50-C3 by making leader withdrawal creation and admin tax review reliable, transactional commands owned by Withdrawal, Commission, RewardLedger, Tax, and Audit domain interfaces.

**Architecture:** Keep Fastify routes as authentication, strict parsing, orchestration invocation, and error mapping only. New command modules normalize and hash requests; narrow owners encapsulate table writes; two executors compose owners in one PostgreSQL transaction and use existing unique keys and `AdminCommandReceipt` for replay. Existing approve/reject/mark-paid orchestration is migrated to the same owners without changing the manual payout workflow.

**Tech Stack:** TypeScript, Fastify, Prisma, PostgreSQL, React/Vite Admin, Vitest, pnpm 9.15.4.

## Global Constraints

- Base is `stable/l50-a3-4-business-base@ca6dd163c9118819bfc9e89879630edcafa8d4e4`; implementation branch is `codex/l50-c3-withdrawal-domain-ownership`.
- Do not change Prisma schema, migrations, dependencies, lockfile, miniapp layout, Admin layout, reward rules, T+7 rules, or money algorithms.
- Money remains integer cents; no float storage or arithmetic.
- Keep manual approval and offline payout; do not add automatic payout, tax integration, invoicing integration, queues, Redis, or services.
- New behavior is limited to strict commands, ownership, deterministic locks, replay/conflict handling, version checks, and transaction rollback.
- Every production behavior begins with a failing test and follows RED → GREEN → refactor.

---

### Task 1: Strict leader and tax-review commands

**Files:**
- Create: `apps/api/src/modules/withdrawal/leader-withdrawal-command.ts`
- Create: `apps/api/src/modules/withdrawal/leader-withdrawal-command.test.ts`
- Create: `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-command.ts`
- Create: `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-command.test.ts`

**Interfaces:**
- Produces: `parseLeaderWithdrawalCommand(input)`, `buildLeaderWithdrawalSemanticSignature(input)`, `parseAdminWithdrawalTaxReviewCommand(input)`, and `buildAdminWithdrawalTaxReviewRequestHash(input)`.
- Leader parsing returns normalized, lexicographically sorted unique commission IDs and preserves optional `amount_cents`.
- Tax parsing returns `idempotency_key`, `expected_version`, normalized tax fields, and a hash whose operation is `admin.withdrawal.tax-review.v1`.

- [ ] **Step 1: Write failing leader command tests**

Cover null/non-object input, unknown fields, untrimmed or overlong `client_request_id`, empty/duplicate commission IDs, normalized ordering, unsafe/non-positive amount, and a literal semantic signature that changes with leader, commission set, or final amount.

- [ ] **Step 2: Verify leader tests fail because the module is missing**

Run: `corepack pnpm --filter @community-selection/api test -- leader-withdrawal-command.test.ts`

Expected: FAIL because `leader-withdrawal-command.js` cannot be resolved.

- [ ] **Step 3: Implement the minimum leader parser and signature**

Use a strict allowed-key set, safe-integer checks, duplicate rejection before sorting, and SHA-256 over `{ leader_user_id, client_request_id, commission_ids, amount_cents }`.

- [ ] **Step 4: Verify leader tests pass**

Run the Step 2 command and expect all leader command tests to pass.

- [ ] **Step 5: Repeat RED → GREEN for tax-review command**

Cover idempotency key ASCII/length, nonnegative `expected_version`, integer money bounds, tax-mode combinations, invoice status, unknown fields, normalization, and a hand-derived stable hash input. Run:

`corepack pnpm --filter @community-selection/api test -- admin-withdrawal-tax-review-command.test.ts`

Expected RED: missing module. Expected GREEN: all tax command tests pass.

### Task 2: Withdrawal and Commission owners

**Files:**
- Create: `apps/api/src/modules/withdrawal/withdrawal-owner.ts`
- Create: `apps/api/src/modules/withdrawal/withdrawal-owner.test.ts`
- Create: `apps/api/src/modules/withdrawal/withdrawal-commission-owner.ts`
- Create: `apps/api/src/modules/withdrawal/withdrawal-commission-owner.test.ts`

**Interfaces:**
- `createWithdrawal(tx, input)`, `linkWithdrawalCommissions(tx, input)`, `loadWithdrawalReplaySnapshot(client, input)`, `lockWithdrawal(tx, id)`, `applyWithdrawalTaxPatch(tx, input)`, and `transitionWithdrawal(tx, input)`.
- `lockWithdrawableCommissions(tx, input)`, `claimCommissionsForWithdrawal(tx, input)`, `releaseCommissionsFromWithdrawal(tx, input)`, and `markCommissionsWithdrawn(tx, input)`.

- [ ] **Step 1: Write failing Withdrawal owner tests**

Prove `SELECT ... FOR UPDATE` occurs before transition reads, create/link data is complete, version-conditioned tax updates increment once, count mismatches fail closed, and no Commission/RewardLedger/Tax/Audit write method is used.

- [ ] **Step 2: Verify correct RED**

Run the Withdrawal owner test file; expect module-resolution failure only.

- [ ] **Step 3: Implement the minimum Withdrawal owner**

Use parameterized Prisma SQL for row locking and Prisma model methods only for Withdrawal and WithdrawalCommission.

- [ ] **Step 4: Verify GREEN**

Run the Withdrawal owner test file and expect all tests to pass.

- [ ] **Step 5: Repeat RED → GREEN for Commission owner**

Tests must prove IDs are locked one-by-one in lexical order, locked rows are revalidated for leader/status/withdrawal/positive amount, and claim/release/paid transitions require exact affected counts. Implement only Commission reads and writes.

### Task 3: RewardLedger and Tax owners

**Files:**
- Create: `apps/api/src/modules/withdrawal/withdrawal-reward-ledger-owner.ts`
- Create: `apps/api/src/modules/withdrawal/withdrawal-reward-ledger-owner.test.ts`
- Create: `apps/api/src/modules/tax-record/withdrawal-tax-owner.ts`
- Create: `apps/api/src/modules/tax-record/withdrawal-tax-owner.test.ts`

**Interfaces:**
- `validateWithdrawalRewardBalance(tx, input)`, `reserveWithdrawalReward(tx, input)`, `restoreRejectedWithdrawalReward(tx, input)`, and `recordPaidWithdrawalReward(tx, input)`.
- `reviewWithdrawalTax(tx, input)` returns `{ withdrawal_patch, tax_record }`.

- [ ] **Step 1: Write failing RewardLedger owner tests**

Use literal fixtures to catch per-commission net mismatch, leader total mismatch, wrong ledger direction/availability effects, and incorrect withdrawal-based idempotency keys.

- [ ] **Step 2: Verify correct RED, implement minimum owner, verify GREEN**

Reuse existing ledger helpers through this narrow owner; do not duplicate balance algorithms.

- [ ] **Step 3: Write failing Tax owner tests**

Catch invalid tax-mode/money/invoice combinations, wrong payable amount, writes outside TaxRecord, payload leakage, and an ambiguous tax patch.

- [ ] **Step 4: Verify correct RED, implement minimum owner, verify GREEN**

Upsert only the withdrawal TaxRecord, return an explicit patch, and retain only the current non-sensitive review snapshot/reference in payload.

### Task 4: Reliable executors and existing admin transitions

**Files:**
- Create: `apps/api/src/modules/withdrawal/leader-withdrawal-executor.ts`
- Create: `apps/api/src/modules/withdrawal/leader-withdrawal-executor.test.ts`
- Create: `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-executor.ts`
- Create: `apps/api/src/modules/withdrawal/admin-withdrawal-tax-review-executor.test.ts`
- Modify: `apps/api/src/modules/withdrawal/admin-withdrawal-executor.ts`
- Modify: `apps/api/src/modules/withdrawal/admin-withdrawal-executor.integration.test.ts`

**Interfaces:**
- `executeLeaderWithdrawalCommand({ leader_user_id, command })` returns the existing leader DTO fields plus `applied` and `idempotent`.
- `executeAdminWithdrawalTaxReviewCommand({ withdrawal_id, command, context, admin_meta })` returns `{ withdrawal, tax_record, idempotent }`.
- Existing `executeAdminWithdrawalCommand` keeps its public signature and response.

- [ ] **Step 1: Write failing leader executor tests**

Prove exact replay compares leader, sorted commission IDs, and final amount; P2002 reload uses the same comparison; owner calls follow lock → validate → create → claim → link → ledger → audit; a failure before commit returns no successful result.

- [ ] **Step 2: Verify correct RED, implement minimum executor, verify GREEN**

Map validation/ledger/transaction conflicts to the approved 400/409/500 messages and persist the existing sanitized ledger-mismatch alert outside the rolled-back transaction.

- [ ] **Step 3: Write failing tax executor tests**

Prove completed receipt replay, same-key/different-hash 409, lock and `expected_version` before Tax write, tax → Withdrawal patch → Audit → receipt completion order, and malformed/incomplete receipts fail closed.

- [ ] **Step 4: Verify correct RED, implement minimum executor, verify GREEN**

Create and complete `AdminCommandReceipt` in the same transaction. Map P2002 to replay and P2034 to a retryable 409 without internal retry.

- [ ] **Step 5: Migrate approve/reject/mark-paid with a failing integration/contract test**

Change the existing executor to call the three owners for Withdrawal, Commission, and RewardLedger transitions while preserving its command and result contracts. Verify the new test fails before migration and passes after it.

### Task 5: Route and Admin wiring

**Files:**
- Modify: `apps/api/src/routes/withdrawals.ts`
- Modify: `apps/api/src/routes/leader-withdrawals-security.test.ts`
- Modify: `apps/admin/src/features/finance/tax-review/api.ts`
- Modify: `apps/admin/src/features/finance/tax-review/api.test.ts`
- Modify: `apps/admin/src/features/finance/tax-review/types.ts`
- Modify: `apps/admin/src/features/finance/tax-review/TaxReviewDrawer.tsx`

**Interfaces:**
- Leader route parses `LeaderWithdrawalCommand`, calls the leader executor, and maps its typed errors.
- Tax route parses `AdminWithdrawalTaxReviewCommand`, applies the current admin data-scope context, calls the tax executor, and maps typed errors.
- Admin tax submission sends one generated `idempotency_key` and the detail `version` as `expected_version`; it no longer sends `client_request_id` or `expected_updated_at`.

- [ ] **Step 1: Write failing API route tests**

Assert unknown fields are rejected, GR-FIN-003 changed-set/changed-amount replays return 409, and routes expose executor results without direct table writes.

- [ ] **Step 2: Verify RED, replace route write blocks, verify GREEN**

Keep all list/detail/export DTOs, copy, permissions, and scope behavior unchanged.

- [ ] **Step 3: Write failing Admin API test**

Assert the serialized body contains `idempotency_key` and `expected_version`, and omits legacy concurrency fields.

- [ ] **Step 4: Verify RED, minimally update types/API/drawer, verify GREEN**

Generate the key once per submit action and pass the same command object to the requester.

### Task 6: Ownership contract, PostgreSQL integration, and release gates

**Files:**
- Create: `apps/api/src/modules/withdrawal/withdrawal-domain-ownership.contract.test.ts`
- Create: `apps/api/src/modules/withdrawal/withdrawal-domain-ownership.integration.test.ts`
- Create: `scripts/verify-l50-c3-withdrawal-domain-ownership.mjs`
- Modify: `scripts/verify-all-local.sh`
- Modify: relevant existing withdrawal/tax verifiers that send legacy tax-review fields
- Modify: `docs/plans/global-risk-register.md`

**Interfaces:**
- Contract test enforces table-write ownership without coupling to formatting.
- PostgreSQL test covers success, replay, GR-FIN-003 conflicts, deterministic competition, ledger mismatch, tax receipt replay/conflict, version competition, and rollback injection.
- Verifier runs focused source contracts, API/Admin tests, PostgreSQL integration when `DATABASE_URL` exists, and both typechecks.

- [ ] **Step 1: Write ownership and integration tests before any final compatibility changes**

Name the production mutation each test catches: route direct write, executor bypass, wrong lock order, incomplete replay comparison, partial claim, premature receipt completion, or swallowed audit failure.

- [ ] **Step 2: Run focused tests and observe RED for remaining behavior**

Run the new contract and integration test files. A missing `DATABASE_URL` is an environment block, not RED/GREEN evidence; use the isolated Runner for final database proof.

- [ ] **Step 3: Make the minimum compatibility/verifier changes and verify focused GREEN**

Update legacy tax-review callers to `idempotency_key` and `expected_version` without weakening their business assertions.

- [ ] **Step 4: Run local release gates**

Run:

```bash
corepack pnpm --filter @community-selection/api test
corepack pnpm --filter @community-selection/admin test
corepack pnpm --filter @community-selection/api typecheck
corepack pnpm --filter @community-selection/admin typecheck
corepack pnpm lint
corepack pnpm build
node scripts/verify-l50-c3-withdrawal-domain-ownership.mjs
```

Expected: zero failures. Existing documented Vite/Ant warnings may remain but no new error.

- [ ] **Step 5: Audit scope and documentation**

Confirm no Schema, migration, dependency, lockfile, environment, miniapp layout, Admin layout, or generated artifact changed. Mark `GR-FIN-003` resolved only after its regression test passes; register the verifier in `verify:all`.

- [ ] **Step 6: Publish atomically and open a Draft PR**

Re-read remote branch head and require it to remain the approved `eb5d3580` lineage. Create one implementation commit containing the reviewed files, fast-forward the existing branch without force, compare it to `ca6dd163`, and create a Draft PR targeting `stable/l50-a3-4-business-base`.

- [ ] **Step 7: Validate on the `community` Runner**

Allow one heavy job at a time. Require real PostgreSQL concurrency/rollback, Admin browser, 61-item baseline audit, `verify:all`, source evidence upload, and cleanup to succeed on the exact PR head before marking Ready.
