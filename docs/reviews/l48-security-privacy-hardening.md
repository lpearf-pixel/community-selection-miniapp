# L48 Security and Privacy Hardening — Reviewer Checklist

## Review scope

- Business base: `stable/l47-business-base@030d06aebe75373600338a2eff92f4fb8e25a607`.
- Business branch: `work/l48-security-privacy-hardening`.
- This stage hardens only `/api/me/**` and `/api/leaders/me/**`, their response DTOs, and HTTP/business logging.
- This stage does not add JWT/OAuth, WeChat session authentication, encryption, rate limiting, CORS redesign, data deletion, automatic payout, or automatic tax filing.
- Trusted `x-user-id` / `x-openid` headers remain the current project boundary and are not complete authentication.

## 1. Current-user route inventory

Confirm that all 12 routes use `withCurrentUser` or `withCurrentLeader` and no route-local/query-capable identity resolver remains:

1. `GET /api/me/center-summary`
2. `GET /api/me/orders`
3. `GET /api/me/orders/:id`
4. `GET /api/me/orders/:id/after-sales`
5. `POST /api/me/orders/:id/after-sales`
6. `GET /api/me/orders/:id/pickup-code`
7. `GET /api/leaders/me/center-summary`
8. `GET /api/leaders/me/withdrawals`
9. `GET /api/leaders/me/withdrawals/:id`
10. `GET /api/leaders/me/withdrawable-commissions`
11. `POST /api/leaders/me/withdrawals`
12. `POST /api/leaders/me/rewards/convert-credit`

## 2. Identity and authorization

- Missing both identity headers returns 401.
- Query-only or body-only identity cannot authenticate.
- When both headers exist, `x-user-id` wins and an unknown higher-priority user ID does not fall back to `x-openid`.
- Query/body identity conflicts cannot switch order, withdrawal, commission, conversion, tax-record, reward-ledger, or consumer-credit ownership.
- Unknown user returns 404; inactive user returns 403.
- A non-leader receives 403 on every `/api/leaders/me/**` route.
- Cross-user order access and cross-leader withdrawal/commission access remain scoped and return the intended 404/403 response.

## 3. Error boundary

- Only `PublicCurrentUserError` with an integer 4xx status exposes its message.
- Prisma, transaction, network, programming, and other unknown failures return a fixed 500 message.
- Responses and logs do not contain raw exception message, stack, host, SQL, Prisma payload, or request input.
- Error-name and error-code metadata accept only stable allow-listed forms.
- Known after-sale, withdrawal, and reward-conversion validation/conflict failures preserve the intended public 4xx status without broad message matching.

## 4. Response privacy

- No current-user response contains raw `openid`, `unionid`, phone, receiver name/address, bank/account data, manual reference, tax/admin remarks, or admin actor IDs.
- Receiver name is first character plus `*`; phone is `139****5678`; address is first three characters plus `***` plus last two characters, or `***` for short values.
- Withdrawal rejection uses the fixed public explanation and only a masked manual reference.
- Reward conversion returns only the explicit public DTO; it does not embed tax records, ledger rows, payload snapshots, leader IDs, or internal actor IDs.
- Recursive response scanning covers nested arrays and objects on both success and failure envelopes.

## 5. HTTP and business logs

- HTTP request logs contain only request ID, method, path without query, and remote address.
- HTTP response logs contain only status code.
- Headers, body, query, cookies, session values, authorization tokens, and full URL never enter the serialized log.
- Business-log payloads and snapshots recursively sanitize identities, contact details, addresses, accounts, manual references, tax/admin notes, and admin actor IDs.
- Event/timeline/alert titles and messages and alert resolution notes are sanitized before persistence.
- Safe logging fallbacks emit only operation, stable error name/code, and safe correlation IDs; no raw error object or input payload is printed.
- Verify unique-marker evidence against the captured independent API process logs, not only unit-test mocks.

## 6. Withdrawal mixed-route file

- Only the four `/api/leaders/me/**` withdrawal blocks and their leader DTO/helpers changed.
- `/api/admin/**` withdrawal/tax routes retain the original permission checks, data-scope filters, transaction behavior, audit writes, and response DTOs.
- The exact-patch safeguard must report an unchanged Admin suffix; the temporary patch script must not remain in the final business diff.
- Withdrawal body identity fields are removed or ignored and all leader reads/writes use the wrapper-provided leader ID.

## 7. Repository and report boundaries

- No changes to `package.json`, `pnpm-lock.yaml`, `prisma/schema.prisma`, or migrations.
- The business branch tracks no `reports/**`, `.tmp/**`, or temporary workflow/patch artifacts.
- L47 center semantics still pass through the compatibility exports.
- The final L48 report is bound to the final business HEAD and exact stable base.
- All nine command evidence rows are `passed` and all ten runtime markers occur exactly once.
- The report keeps the trusted-header limitation and contains no claims of complete authentication, encryption, rate limiting, automatic payout, automatic tax filing, zero risk, or absolute security.
- Final PR is opened without auto-merge and is not merged before human approval.
