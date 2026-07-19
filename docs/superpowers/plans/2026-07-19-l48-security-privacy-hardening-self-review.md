# L48 Implementation Plan Self-Review Decisions

This document is a normative correction to `2026-07-19-l48-security-privacy-hardening.md`. When wording differs, this document takes precedence.

## 1. Route inventory and verifier parsing

The final L48 route inventory contains 13 route registrations across six production files:

- `apps/api/src/routes/me/center.ts`
  - `GET /api/me/center-summary`
- `apps/api/src/routes/me/orders.ts`
  - `GET /api/me/orders`
  - `GET /api/me/orders/:id`
  - `GET /api/me/orders/:id/after-sales`
  - `POST /api/me/orders/:id/after-sales`
  - `GET /api/me/orders/:id/pickup-code`
- `apps/api/src/routes/leaders/center.ts`
  - `GET /api/leaders/me/center-summary`
- `apps/api/src/routes/commissions.ts`
  - `GET /api/leaders/me/commissions`
- `apps/api/src/routes/withdrawals.ts`
  - `GET /api/leaders/me/withdrawals`
  - `GET /api/leaders/me/withdrawals/:id`
  - `GET /api/leaders/me/withdrawable-commissions`
  - `POST /api/leaders/me/withdrawals`
- `apps/api/src/routes/rewards.ts`
  - `POST /api/leaders/me/rewards/convert-credit`

The verifier must discover routes rather than hard-code only this list, but this list is the minimum expected inventory. The commissions route was found by the final automatic inventory review and is normative for L48 completion.

The recursive scan must exclude:

```ts
file.endsWith('.test.ts') || file.endsWith('.spec.ts') || file.endsWith('.d.ts')
```

`withdrawals.ts` and `commissions.ts` contain both current-leader and Admin routes. Therefore the verifier must inspect individual route-registration blocks, not reject an entire file because an Admin block contains legacy Admin error handling.

Use a route-registration matcher equivalent to:

```ts
const routeRegistrationPattern = /app\.(get|post|put|patch|delete)\s*\(\s*(["'`])(\/api\/[^"'`]+)\2/g;
```

For each match, define its source block from the current match index to the next route-registration match index, or end of file. Apply L48 wrapper/error assertions only when the captured path starts with `/api/me/` or `/api/leaders/me/`.

Each current-user route block must contain `withCurrentUser(` or `withCurrentLeader(` and must not contain:

```ts
resolveUserIdentity
resolveCurrentLeader(request)
resolveLeaderId
statusCode ?? 400
fail(error instanceof Error ? error.message
```

Admin route blocks are outside this L48 assertion and remain governed by existing Admin verifiers.

## 2. L43/L44/L47 compatibility decisions

Do not delete `apps/api/src/modules/me-center/me-center-route-security.ts` during L48.

Replace its implementation with compatibility aliases to the shared current-user core so older imports or L47 verification references cannot silently drift:

```ts
export {
  resolveCurrentUser as resolveCenterUserIdentity,
  mapCurrentUserRouteError as mapCenterRouteError,
} from '../current-user/current-user-security.js';
```

The two center routes themselves must import and use `withCurrentUser` / `withCurrentLeader`, not the compatibility aliases. Update the L47 verifier to validate the shared implementation while preserving all L47 security requirements.

Update the L43 and L44 historical verifiers to require the shared `withCurrentLeader` boundary and explicitly prohibit the removed `resolveLeaderId` / `resolveCurrentLeader(request)` patterns. These verifier changes preserve historical business rules; they do not alter Admin permissions or data scope.

## 3. Withdrawal body compatibility decision

Remove `leader_user_id` and `openid` from `WithdrawBody`. The current miniapp sends only `client_request_id` and `commission_ids`, so there is no compatibility need to retain identity fields.

Do not split `withdrawals.ts` in L48. Migrate only the four `/api/leaders/me/**` route blocks. Leave all `/api/admin/**` route behavior and authorization unchanged.

Use this exact public ledger mismatch response:

```ts
throw publicCurrentUserError('奖励账本待人工复核', 409);
```

Never return the serialized mismatch payload to the client.

## 4. Response privacy corrections

Add `receiver_name` to `L48_PROHIBITED_RESPONSE_KEYS` alongside `receiver_phone` and `receiver_address`.

Order list/detail responses may expose only these receiver fields:

```ts
receiver_name_masked
receiver_phone_masked
receiver_address_masked
```

They must not expose raw `receiver_name`, `receiver_phone`, or `receiver_address` at any nesting level.

The masking behavior is fixed:

```ts
function maskReceiverName(value?: string | null) {
  return value ? `${value.slice(0, 1)}*` : null;
}

function maskReceiverPhone(value?: string | null) {
  return value ? value.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2') : null;
}

function maskReceiverAddress(value?: string | null) {
  if (!value) return null;
  return value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : '***';
}
```

The L48 order security tests and Docker E2E must recursively assert that raw receiver keys are absent.

Leader commission and reward-conversion responses must use explicit public DTOs and must not expose `leader_user_id`, review/admin notes, admin actor IDs, tax-record objects, ledger objects, or payload snapshots.

## 5. HTTP and business log decisions

HTTP request logs retain only request ID, method, and query-free path. Do not persist client IP, request headers, body, query, cookies, or session values. HTTP response logs retain only status code; Fastify may retain its normal response-time field outside the response serializer.

Business-log payloads, snapshots, free text, and safe-fallback console output are sanitized. Dedicated structured audit association columns remain intact, including top-level business IDs, `actor_user_id`, and `OpsAlertLog.resolved_by`.

For a mapped 500, wrappers may log only:

```ts
request.log.error(
  safeErrorLogMetadata('current-user-route', error),
  fallbackMessage,
);
```

The second argument is the fixed route fallback text, never `error.message`. The metadata object may contain only `operation`, `error_name`, and `error_code`.

## 6. Execution rule

Execute the main implementation plan task-by-task with this self-review document loaded. These decisions remove all remaining implementation alternatives; no task may reintroduce query/body identity ownership, file-wide false positives against Admin code, raw receiver fields, client-IP logging, destruction of structured audit actor fields, or deletion of the L47 compatibility module.
