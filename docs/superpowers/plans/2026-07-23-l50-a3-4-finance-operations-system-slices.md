# L50-A3.4 Finance / Operations / System Slice Plan

> **Execution:** Use `superpowers:executing-plans` task-by-task with TDD.

**Goal:** Remove the final withdrawal, operations-alert, and tax-record business state from `AdminApp` while preserving authentication, navigation, global messages, and all existing operator behavior.

**Architecture:** Keep `AdminApp` as the authenticated composition root. Mount three isolated feature pages for the authenticated session and hide inactive pages so filters, drawers, and errors survive navigation. Each page owns its typed API, request lifecycle, retry, refresh version, and mutations. `AdminApp` owns only refresh-version composition and message callbacks. No server, Prisma, miniapp, POS, dependency, or deployment changes.

**Baseline:** The content tree is the verified A3.3 source tree whose squash merge is `6063d6cd5fe156c5ecd954a4841017a1de371dad`; remote `stable/l50-a3-3-business-base` is identical to that merge.

## Invariants

- Withdrawals use `/api/admin/withdrawals` plus existing detail, approve, reject, and mark-paid endpoints.
- Alerts use `/api/admin/logs/alerts` plus resolve and ignore endpoints.
- Tax review uses `/api/admin/tax-records`, detail, export, and withdrawal tax-review endpoints.
- Each page has independent initial load, refresh, retry, stale-response protection, and render error boundary.
- Shell refresh targets only the active extracted page.
- A successful mutation calls one composition callback that refreshes all thirteen A3 slices.
- Authentication restore and login do not preload business data.
- `AdminApp` contains no DTO, endpoint, handler, table, or state for the three extracted domains.
- Authentication, session, navigation, global message, compact inventory references, and existing non-A3 legacy pages remain unchanged.

## Task 1: Lock the A3.4 contracts with failing tests

**Files**

- Modify: `apps/admin/src/app/refresh-policy.test.ts`
- Add: `apps/admin/src/features/finance/withdrawals/api.test.ts`
- Add: `apps/admin/src/features/finance/tax-review/api.test.ts`
- Add: `apps/admin/src/features/operations/alerts/api.test.ts`
- Add: `apps/admin/src/features/a3-4-pages-source-contract.test.ts`

**Steps**

1. Add refresh mappings for `withdrawals`, `alerts`, and `taxRecords`; require that no `legacy` refresh target remains for these views.
2. Require `AdminApp` to contain three refresh versions, three mounted boundaries, and no legacy DTOs/endpoints/handlers/JSX.
3. Require the composed mutation refresh to increment all thirteen extracted versions without calling `refreshLegacyFeatures`.
4. Test exact API paths, methods, bodies, and `AbortSignal` forwarding for all three domains.
5. Require each page to use `useFeatureResourceLoader` or the latest-request guard, expose inline retry, and accept `refreshVersion`.
6. Run the focused tests and verify failures are caused by the missing A3.4 behavior.

## Task 2: Add typed API boundaries

**Files**

- Add: `apps/admin/src/features/finance/withdrawals/types.ts`
- Add: `apps/admin/src/features/finance/withdrawals/api.ts`
- Add: `apps/admin/src/features/finance/tax-review/types.ts`
- Add: `apps/admin/src/features/finance/tax-review/api.ts`
- Add: `apps/admin/src/features/operations/alerts/types.ts`
- Add: `apps/admin/src/features/operations/alerts/api.ts`

**Steps**

1. Move/re-export the existing withdrawal and tax DTOs into feature-local type files without changing wire shapes.
2. Implement list/detail/mutation/export functions with the shared authenticated Admin API client.
3. Implement alert list, resolve, and ignore functions with exact existing payloads.
4. Accept optional `JsonRequester` and `AbortSignal` on primary loaders for deterministic tests.
5. Run the three API tests until green.

## Task 3: Extract the three independent pages

**Files**

- Add: `apps/admin/src/features/finance/withdrawals/WithdrawalsPage.tsx`
- Add: `apps/admin/src/features/finance/tax-review/TaxReviewPage.tsx`
- Add: `apps/admin/src/features/operations/alerts/OperationsAlertsPage.tsx`
- Modify/Delete: existing `apps/admin/src/pages/withdrawals/*` and `apps/admin/src/pages/tax-review/*` only as needed to remove duplicate ownership

**Steps**

1. Preserve current withdrawal filters, pagination, detail drawer, warnings, and mutation success/error messages.
2. Preserve current tax filters, pagination, export, detail drawer, optimistic-version payload, and compliance warnings.
3. Preserve the legacy alert table fields and resolve/ignore actions.
4. Use abortable primary loaders, generation guards, inline error alerts, retry buttons, and refresh versions.
5. After each successful mutation call `onMutationCommitted`; use `onMessage` for the Shell message without hiding inline request errors.
6. Run focused source contracts and Admin typecheck until green.

## Task 4: Remove the final legacy business ownership from AdminApp

**Files**

- Modify: `apps/admin/src/app/AdminApp.tsx`
- Modify: `apps/admin/src/app/refresh-policy.ts`
- Modify: `apps/admin/src/app/refresh-policy.test.ts`

**Steps**

1. Replace the three old page imports and inline JSX with the feature pages mounted behind individual `AdminErrorBoundary` instances.
2. Add three refresh-version states and map Shell refresh to them.
3. Rename the composed refresh to reflect all extracted business slices and increment all thirteen versions exactly once.
4. Remove `refreshLegacyFeatures`, the three legacy DTOs/states, fetches, and handlers.
5. Remove authentication-time business preloading; mounted pages load independently after authentication.
6. Keep auth/session/Shell/global message and non-A3 pages unchanged.
7. Run refresh-policy, source-contract, all Admin tests, and typecheck.

## Task 5: Verify scope and behavior

**Files**

- Modify: `scripts/admin-e2e/contract.test.cjs`
- Modify: `scripts/admin-e2e/admin-smoke.mjs` only when a behavior assertion is required

**Steps**

1. Lock exact endpoint isolation and 23/23 navigation behavior.
2. Verify one failed domain does not block the other two or the Shell.
3. Verify Shell refresh affects only the active page and mutations refresh all extracted pages.
4. Verify no API, Prisma, miniapp, POS, lockfile, dependency, or deployment file changed.
5. Run:
   - `pnpm --filter @community-selection/admin test`
   - `pnpm --filter @community-selection/admin typecheck`
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm --filter @community-selection/admin build`
   - Admin E2E contract and real PostgreSQL/Playwright Runner

## Task 6: Review and publish

1. Inspect the complete diff against the verified A3.3 content tree.
2. Run `superpowers:verification-before-completion`.
3. Commit intentional changes only; exclude dependency directories, generated build output, and reconstructed fixtures.
4. Use `github:yeet` to push and open a Draft PR against `stable/l50-a3-3-business-base`.
5. Re-read the remote PR head, changed files, review threads, and Runner result.
6. If all gates pass, squash merge using the verified remote head.
7. Create `stable/l50-a3-4-business-base` at the verified merge commit and prove it is identical.

## Self-review

- Spec coverage: all approved A3.4-A requirements map to Tasks 1–6.
- Placeholder scan: no implementation placeholders or deferred production behavior.
- Type consistency: page names, refresh targets, callback names, endpoint names, and thirteen-slice invalidation are consistent throughout.
- Explicit exclusions: authentication/Shell redesign belongs to L50-B; server and persistence changes are outside A3.4.
