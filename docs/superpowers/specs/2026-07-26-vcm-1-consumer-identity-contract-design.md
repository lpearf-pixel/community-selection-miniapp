# VCM-1 Consumer Identity Verification Contract

## Goal

Move active release verifiers to `identity.consumer.v2` so a consumer identity
contract change fails in an early static gate instead of near the end of
`verify:all`.

## Scope

VCM-1 covers only consumer requests to:

- `POST /api/orders`
- `POST /api/orders/normal`

It does not change production authentication, administrator sessions, payment
or refund contracts, group-buy ownership, or inactive historical verifiers.

## Shared verifier request boundary

`scripts/lib/consumer-verifier-request.ts` owns test-only consumer injection.
It must:

- enable trusted mock identity only outside production;
- require a non-empty test user ID before calling Fastify;
- add `x-user-id` to the request;
- remove `user_id` and `user_openid` from the payload;
- preserve all non-identity payload fields and existing non-identity headers.

The helper is verifier-only infrastructure. Production routes and
`resolveCurrentUser` remain unchanged.

## Active verifier scope

The contract scanner derives its targets from commands currently executed by
`scripts/verify-all-local.sh`, plus registered Stage verifiers. It does not
auto-discover every historical file in `scripts/`.

For the two protected order endpoints, active verifier source must not:

- submit `user_id` or `user_openid` in the request payload;
- send a request without the shared helper or an explicit trusted identity
  header.

Failures include the exact file and line.

## Contract declaration

`scripts/stage-registry.ts` exposes the minimal L51 declaration:

```ts
{
  id: 'L51',
  contracts: ['identity.consumer.v2'],
}
```

This declaration is intentionally not a dependency graph and does not add L49,
L50, or L51 to the existing L24-L48 verifier execution chain.

## CI ordering

The consumer identity contract test and static verifier run before database
setup in the L51 focused gate. `verify:all` also runs the static verifier before
database generation or migration.

## Acceptance

- The shared helper rejects a missing user ID before `app.inject`.
- The shared helper strips body identity and adds `x-user-id`.
- A fixture containing an old body identity request is rejected with file and
  line.
- L51 declares `identity.consumer.v2`.
- Active release verifiers use the shared helper for the protected endpoints.
- Missing trusted identity still returns 401.
- Body-only forged identity does not authenticate.
- L12, L50 refund gate, L51 gate, baseline audit, and `verify:all` pass.
- Production authentication code is unchanged.

