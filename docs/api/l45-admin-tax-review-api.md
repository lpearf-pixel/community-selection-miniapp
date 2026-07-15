# L45 Admin Tax Review API

## Scope and identity model

L45 Admin APIs require an active Admin identity and data scope. The backend distinguishes `session` scope from non-production `header_mock` scope.

- `session`: formal Admin session identity. `super_admin` has full data scope. Until server-persisted Admin scope exists, production non-`super_admin` sessions fail closed with empty data scope and cannot expand scope through browser headers.
- `header_mock`: local/dev mock identity and scope from `x-admin-*` headers. This is accepted only when `NODE_ENV !== "production"` and no formal session identity is present.
- Admin UI sends `x-admin-user-id`, `x-admin-role`, `x-admin-community-id`, and `x-admin-pickup-store-id` only in Vite dev mode or when `VITE_ADMIN_MOCK_HEADERS=true`. Production sessions use cookies/credentials only.

## APIs

| API | Method | Path | Permission | Scope | Success | Errors | Runtime marker |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tax record list | GET | `/api/admin/tax-records` | `finance.view` | data scope | 200 | 400, 401, 403 | `l45_tax_list_scope_success=true` |
| Tax record detail | GET | `/api/admin/tax-records/:id` | `finance.view` | data scope | 200 | 401, 403, 404 | `l45_tax_detail_success=true` |
| Tax record export | GET | `/api/admin/tax-records/export.csv` | `finance.export` | data scope | 200 | 400, 401, 403, 422 | `l45_tax_export_success=true`, `l45_tax_export_over_limit_http_422=true` |
| Tax review | POST | `/api/admin/withdrawals/:id/tax-review` | `withdrawal.manage` | data scope | 200 | 400, 401, 403, 404, 409 | `l45_tax_review_success=true`, `l45_tax_review_concurrent_counts=true` |
| Mark paid | POST | `/api/admin/withdrawals/:id/mark-paid` | `withdrawal.manage` | data scope | 200 | 400, 401, 403, 409 | `l45_mark_paid_success=true`, `l45_mark_paid_conflict_409=true` |

## Tax review request fields

Required:

- `client_request_id`: string, trim length 1-80.
- `expected_updated_at`: required for new keys only; same-key exact replay does not require current mutable state.
- `tax_mode`: one of `none`, `withheld`, `invoice`.
- `taxable_amount_cents`: required JSON number, safe integer, 0..2147483647.
- `tax_amount_cents`: required JSON number, safe integer, 0..2147483647.

Optional:

- `invoice_status`: one of `not_required`, `pending`, `verified`, `rejected`; server normalizes non-invoice modes to `not_required`.
- `tax_rate_basis`, `tax_remark`.

The client cannot set `tax_status` or `invoice_required`; both are server-derived.

## Status derivation and amount rules

- `none` -> `tax_status=completed`, `invoice_required=false`, `invoice_status=not_required`, and `tax_amount_cents` must be `0`.
- `withheld` -> `tax_status=calculated`, `invoice_required=false`, `invoice_status=not_required`.
- `invoice + verified` -> `tax_status=completed`.
- `invoice + pending/rejected` -> `tax_status=pending_invoice`.
- `taxable_amount_cents` cannot exceed withdrawal amount.
- `tax_amount_cents` cannot exceed taxable amount.
- All stored money remains integer cents.

## Error priority

- Authentication failures return 401.
- Permission or data-scope failures return 403.
- Missing resource returns 404 where applicable.
- Invalid payload shape, missing required money fields, string numbers, nulls, decimals, overflows, negative amounts, and invalid `none` tax amount return 400.
- State conflicts, stale `expected_updated_at`, same-key semantic conflicts, terminal new-key reviews, and mark-paid precondition failures return 409.
- CSV export over limit returns 422 with the standard JSON failure envelope.

## Idempotency matrix

- New key + current `expected_updated_at`: apply review.
- Same key + same semantic snapshot: return `idempotent=true`, including after paid/rejected terminal states, without new audit/event writes.
- Same key + invalid payload: payload validation returns 400 before semantic conflict handling.
- Same key + valid different snapshot: return 409.
- New key after terminal state: return 409.
- Stale new key: return 409.
- Concurrent same-key identical requests: exactly two fulfilled responses, one applied and one idempotent.

## Mark-paid preconditions

- `manual_reference` is required; missing/empty returns 400.
- Withdrawal must be `approved`; otherwise 409.
- Tax status must be `completed` or `calculated`; otherwise 409.
- If invoice is required, invoice status must be `verified`; otherwise 409.
- Linked Commission rows must still be `withdrawing`, belong to the Withdrawal, and match `WithdrawalCommission`; otherwise 409.

## CSV behavior

- Successful CSV starts with UTF-8 BOM.
- Formula-leading cells (`=`, `+`, `-`, `@`, tab, CR/LF) are prefixed safely.
- Export uses a deterministic `limit + 1` guard and never returns partial CSV when over limit.
- Over-limit export returns HTTP 422 JSON failure, no BOM, and no `Content-Disposition: attachment`.

## Required runtime markers by API

A report may mark an API as `verified=yes` only when every marker in that API group is present in the final Docker/stage verify output.

- Tax record list: `l45_tax_list_scope_success=true`, `l45_admin_scope_runtime=true`.
- Tax record detail: `l45_tax_detail_success=true`.
- Tax record export: `l45_tax_export_success=true`, `l45_tax_export_over_limit_http_422=true`, `l45_csv_formula_safe=true`.
- Tax review: `l45_tax_review_success=true`, `l45_tax_review_stale_version_409=true`, `l45_tax_review_terminal_replay=true`, `l45_tax_review_new_key_terminal_409=true`, `l45_tax_review_invalid_same_key_400=true`, `l45_tax_review_valid_same_key_409=true`, `l45_tax_review_concurrent_counts=true`.
- Mark paid: `l45_mark_paid_success=true`, `l45_mark_paid_conflict_409=true`, `l45_mark_paid_rollback_verified=true`.

## Stale version 409 semantics

For a new `client_request_id`, the backend compares `expected_updated_at` with the current Withdrawal `updated_at` before writing any Review side effects. If the value is stale while the Withdrawal is still in an otherwise reviewable state, the API returns HTTP 409 with exactly:

```text
提现税务状态已变化，请刷新后重试
```

The stale request must not mutate Withdrawal, append the failed key to `TaxRecord.payload.review_requests`, or write `AdminAuditLog` / `BusinessEventLog` rows.

## Mark-paid transaction atomicity

All mark-paid state changes run in one transaction. For tax-status conflicts, unverified invoice conflicts, and Commission association/status conflicts, HTTP 409 must roll back the attempted Withdrawal update and must not write `manual_reference`, `processed_at`, `processed_by_admin_id`, Commission status changes, `withdrawal_paid` RewardLedger rows, `withdrawal_mark_paid` AdminAuditLog rows, or `withdrawal_mark_paid` BusinessEventLog rows.

## Known medium risk

`buildTaxRecordWhere` currently reads visible Withdrawal IDs into memory and constructs a TaxRecord `source_id IN (...)` filter. This preserves correct count and pagination semantics for L45, but it is a known medium scale risk and should be replaced by a database-side `EXISTS`/JOIN query in a later stage.
