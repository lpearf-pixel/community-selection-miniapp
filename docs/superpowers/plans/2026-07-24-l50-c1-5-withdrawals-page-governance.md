# L50-C1.5 Withdrawals Page Governance Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Split the 348-line withdrawals page into typed workbench, drawer, and orchestration boundaries with zero behavior change.

**Architecture:** The page retains all state, loaders, abort handling, prompts, API calls and side effects; children are synchronous views.

## Constraints

- Main page at most 200 lines.
- Preserve filters, queryVersion, page size, DTOs, masking, action guards, copy and manual-only semantics.
- No automatic payout, API, Prisma, dependency, lockfile, catalog, group-buy, miniapp or POS work.

### Task 1: RED structure contract

Create `withdrawals-page-structure.test.ts`; require `WithdrawalsWorkbench` and
`WithdrawalDetailDrawer`, and forbid inline Table/Drawer/DatePicker/Select/Input/Card.
Run it and confirm failure on 348 lines and missing views.

### Task 2: Extract the workbench

Create `WithdrawalsWorkbench.tsx` with typed list/filter/action props. Move the existing
Card, filter controls, warning, seven columns, pagination and four action buttons unchanged.
Callbacks return to the page; no API call enters the child.

### Task 3: Extract the drawer and GREEN

Create `WithdrawalDetailDrawer.tsx`. Wire detail/open/close without moving the detail
AbortController. Run structure, API, A3.4 and strict TypeScript; require <=200 lines.

### Task 4: Verify and deliver

Run full workspace lint/typecheck/test/build, Admin auth/runtime/source contracts,
PostgreSQL + Playwright and cleanup. Review scope, delete the temporary workflow,
verify final head and squash merge.
