# L48 Security and Privacy Hardening — Reviewer Checklist

## Review scope

- Business base: `stable/l47-business-base@a23401df53cfae1cd41fd47f94c59f3f974d1e60`.
- Business branch: `work/l48-security-privacy-hardening`.
- This stage hardens only `/api/me/**` and `/api/leaders/me/**`, their response DTOs, and HTTP/business logging.
- This stage does not add JWT/OAuth, WeChat session authentication, encryption, rate limiting, CORS redesign, data deletion, automatic payout, or automatic tax filing.
- Trusted `x-user-id` / `x-openid` headers remain the current project boundary and are not complete authentication.

## 1. Current-user route inventory

Confirm that all 14 routes use `withCurrentUser` or `withCurrentLeader` and no route-local/query-capable identity resolver remains:

1. `GET /api/me/center-summary`
2. `GET /api/me/orders`
3. `GET /api/me/orders/:id`
4. `GET /api/me/orders/:id/after-sales`
5. `POST /api/me/orders/:id/after-sales`
6. `GET /api/me/orders/:id/pickup-code`
7. `GET /api/leaders/me/center-summary`
8. `GET /api/leaders/me/dashboard`
9. `GET /api/leaders/me/commissions`
10. `GET /api/leaders/me/withdrawals`
11. `GET /api/leaders/me/withdrawals/:id`
12. `GET /api/leaders/me/withdrawable-commissions`
13. `POST /api/leaders/me/withdrawals`
14. `POST /api/leaders/me/rewards/convert-credit`

## 2. Identity and authorization

- Missing both identity headers returns 401.
- Query-only or body-only identity cannot authenticate.
- When both headers exist, `x-user-id` wins and an unknown higher-priority user ID does not fall back to `x-openid`.
- Query/body identity conflicts cannot switch order, withdrawal, commission, conversion, tax-record, reward-ledger, or consumer-credit ownership.
- Unknown user returns 404; inactive user returns 403.
- A non-leader receives 403 on every `/api/leaders/me/**` route.
- Cross-user order access and cross-leader reward/withdrawal/commission access remain scoped and return the intended 404/403 response.

## 3. Error boundary

- Only `PublicCurrentUserError` with an integer 4xx status exposes its message.
- Prisma, transaction, network, programming, and other unknown failures return a fixed 500 message.
- Responses and logs do not contain raw exception message, stack, host, SQL, Prisma payload, or request input.
- Error-name and error-code metadata accept only stable allow-listed forms.
- Known after-sale, withdrawal, reward-query, and reward-conversion validation/conflict failures preserve the intended public 4xx status without broad message matching.

## 4. Response privacy

- No current-user response contains raw `openid`, `unionid`, phone, receiver name/address, bank/account data, manual reference, tax/admin remarks, or admin actor IDs.
- Receiver name is first character plus `*`; phone is `139****5678`; address is first three characters plus `***` plus last two characters, or `***` for short values.
- Withdrawal rejection uses the fixed public explanation and only a masked manual reference.
- Leader reward query and conversion return only explicit public DTOs; they do not embed leader IDs, review notes, admin actors, tax records, ledger rows, or payload snapshots.
- Recursive response scanning covers nested arrays and objects on both success and failure envelopes.

## 5. HTTP and business logs

- HTTP request logs contain only request ID, method, and path without query.
- HTTP response logs contain only status code; Fastify retains its normal response-time field outside the response serializer.
- Client IP, headers, body, query, cookies, session values, authorization tokens, and full URL never enter the serialized request log.
- Business-log payloads and snapshots recursively sanitize identities, contact details, addresses, accounts, manual references, tax/admin notes, and admin actor IDs.
- Event/timeline/alert titles and messages and alert resolution notes are sanitized before persistence.
- Structured audit association fields such as `resolved_by`, top-level `actor_user_id`, and top-level business IDs remain intact in their dedicated columns; only free text and nested payload/snapshot content are sanitized.
- Safe logging fallbacks emit only operation, stable error name/code, and safe correlation IDs; no raw error object or input payload is printed.
- Verify unique-marker evidence against the captured independent API process logs, not only unit-test mocks.

## 6. Mixed route files

- In `withdrawals.ts`, only the four `/api/leaders/me/**` blocks and their leader DTO/helpers changed; `/api/admin/**` withdrawal/tax routes retain permission, data scope, transaction, audit, and DTO behavior.
- In `commissions.ts`, only `GET /api/leaders/me/commissions` changed identity/error wrapping; Admin reward permission, data scope, global-operation, review, freeze/unfreeze, and backfill behavior remain unchanged.
- In `group-buys.ts`, only `GET /api/leaders/me/dashboard` changed identity/error wrapping; public order/group-buy routes and Admin routes retain their existing behavior.
- The exact withdrawal patch safeguard reported an unchanged Admin suffix; the temporary patch script must not remain in the final business diff.
- Query/body identity fields are removed or ignored and all current-user reads/writes use the wrapper-provided user or leader ID.

## 7. Repository and report boundaries

- No changes to `package.json`, `pnpm-lock.yaml`, `prisma/schema.prisma`, or migrations.
- The business branch tracks no `reports/**`, `.tmp/**`, or temporary workflow/patch artifacts.
- L43, L44, and L47 compatibility verifiers validate the shared identity implementation without requiring removed route-local resolvers.
- The L12 fulfillment verifier calls the leader dashboard with `x-user-id`, not the removed query-only identity path.
- The final L48 report is bound to the final business HEAD and exact stable base.
- All nine command evidence rows are `passed` and all ten runtime markers occur exactly once.
- The report keeps the trusted-header limitation and contains no claims of complete authentication, encryption, rate limiting, automatic payout, automatic tax filing, zero risk, or absolute security.
- Final PR is opened without auto-merge and is not merged before human approval.
