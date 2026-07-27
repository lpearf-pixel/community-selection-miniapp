# VCM-1 Consumer Identity Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make active consumer-order verifiers use one `identity.consumer.v2` request boundary and fail early when legacy body identity returns.

**Architecture:** A test-only TypeScript helper creates authenticated Fastify injection requests while stripping untrusted body identity. A CJS static analyzer scans only verifier commands active in `verify:all` and the Stage registry, and L51 records the contract version without changing the existing stage execution chain.

**Tech Stack:** Node.js 22, TypeScript 5.7, Fastify injection, Node test runner, pnpm workspace, GitHub Actions.

## Global Constraints

- Do not modify production authentication or `resolveCurrentUser`.
- Do not accept `user_id` or `user_openid` from protected order payloads.
- Do not enable mock headers in production.
- Limit scanning to active release verifiers.
- Keep PR #117 draft and target `stable/l50-a3-4-business-base`.

---

### Task 1: Shared consumer verifier request boundary

**Files:**
- Create: `scripts/lib/consumer-verifier-request.ts`
- Create: `scripts/lib/consumer-verifier-request.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: a Fastify-compatible object exposing `inject(options)`.
- Produces: `enableConsumerVerifierMockIdentity(env)` and `injectAsConsumer(app, userId, request)`.

- [ ] **Step 1: Write failing helper tests**

Test literal behavior: missing ID rejects before injection, production mock
enablement rejects, and a valid request removes `user_id/user_openid`, retains
business fields, and sends `x-user-id`.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run scripts/lib/consumer-verifier-request.test.ts
```

Expected: failure because `consumer-verifier-request.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

```ts
export function enableConsumerVerifierMockIdentity(
  env: NodeJS.ProcessEnv = process.env,
): void;

export function injectAsConsumer<TResponse>(
  app: { inject(options: ConsumerInjectOptions): Promise<TResponse> },
  userId: string,
  request: ConsumerInjectOptions,
): Promise<TResponse>;
```

`injectAsConsumer` validates `userId`, strips the two forbidden payload keys,
merges headers, and overwrites `x-user-id` with the validated ID.

- [ ] **Step 4: Verify GREEN**

Run the Step 2 command and require all tests to pass.

- [ ] **Step 5: Register the focused test command**

Add:

```json
"test:vcm1": "vitest run scripts/lib/consumer-verifier-request.test.ts && node --test scripts/verification-contract/consumer-identity-contract.test.cjs"
```

### Task 2: Active-verifier static contract gate

**Files:**
- Create: `scripts/verification-contract/consumer-identity-contract.cjs`
- Create: `scripts/verification-contract/consumer-identity-contract.test.cjs`
- Create: `scripts/verify-consumer-identity-contract-local.cjs`
- Modify: `scripts/stage-registry.ts`
- Modify: `scripts/verify-stage-registry-local.ts`

**Interfaces:**
- Consumes: `scripts/verify-all-local.sh`, `STAGE_REGISTRY`, and verifier source.
- Produces: `activeVerifierFiles(root)`, `findConsumerIdentityViolations(root, files)`, and L51 contract declaration.

- [ ] **Step 1: Write failing analyzer tests**

Use a temporary repository fixture. Assert that an active verifier containing
`payload: { user_id: user.id }` for `/api/orders` returns a violation with its
file and line, while `injectAsConsumer(...)` and an explicit `x-user-id` request
pass. Assert that an inactive historical verifier is not scanned.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test scripts/verification-contract/consumer-identity-contract.test.cjs
```

Expected: failure because the analyzer module does not exist.

- [ ] **Step 3: Implement target discovery and source analysis**

Extract active TypeScript verifier paths from `verify-all-local.sh`, add Stage
registry verifier paths, and analyze only calls to `/api/orders` and
`/api/orders/normal`. Emit `path:line: message` for body identity or missing
shared/explicit trusted identity.

- [ ] **Step 4: Add the L51 contract declaration**

Export:

```ts
export const STAGE_CONTRACT_DECLARATIONS = [
  { id: 'L51', contracts: ['identity.consumer.v2'] },
] as const;
```

Extend `verify-stage-registry-local.ts` to require exactly that declaration and
to confirm it does not alter `latestRegisteredStage()` or the L24-L48 chain.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
node --test scripts/verification-contract/consumer-identity-contract.test.cjs
node --import tsx scripts/verify-stage-registry-local.ts
```

Require both commands to exit 0.

### Task 3: Migrate active protected order requests

**Files:**
- Modify: `scripts/verify-l12-fulfillment-local.ts`
- Modify: `scripts/verify-l13-inventory-purchase-local.ts`
- Modify: `scripts/verify-l14-5-modular-boundary-local.ts`
- Modify: `scripts/verify-l17-5-normal-purchase-local.ts`
- Modify: `scripts/verify-l18-user-order-center-local.ts`
- Modify: `scripts/verify-l19-product-purchase-entry-local.ts`
- Modify: `scripts/verify-l20-miniapp-e2e-release-local.ts`
- Modify: `scripts/verify-l21-miniapp-location-selection-local.ts`
- Modify: `scripts/verify-l22-miniapp-order-center-local.ts`
- Modify: `scripts/verify-l23-mvp-release-readiness-local.ts`
- Modify: `scripts/verify-all-local.sh`

**Interfaces:**
- Consumes: `enableConsumerVerifierMockIdentity` and `injectAsConsumer`.
- Produces: active verifier requests conforming to `identity.consumer.v2`.

- [ ] **Step 1: Run the static verifier before migration**

Run:

```bash
node scripts/verify-consumer-identity-contract-local.cjs
```

Expected: failure listing L12, L13, L14.5, L17.5, L18, L19, L20, L21, L22,
and L23 request sites that still send body identity.

- [ ] **Step 2: Migrate only reported active request sites**

In each listed verifier, import:

```ts
import {
  enableConsumerVerifierMockIdentity,
  injectAsConsumer,
} from './lib/consumer-verifier-request.js';
```

Call:

```ts
enableConsumerVerifierMockIdentity();
const app = buildApp();
```

Replace each protected request with this shape and remove body identity:

```ts
await injectAsConsumer(app, user.id, {
  method: 'POST',
  url: '/api/orders',
  payload: {
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order`,
    quantity: 1,
  },
});
```

- [ ] **Step 3: Put the static gate first in verify:all**

Run the CJS static verifier before `db:generate`, ensuring contract drift fails
without starting PostgreSQL.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm test:vcm1
node scripts/verify-consumer-identity-contract-local.cjs
node --import tsx scripts/verify-l12-fulfillment-local.ts
```

The L12 command requires the normal PostgreSQL verification environment.

### Task 4: CI integration and full verification

**Files:**
- Modify: `.github/workflows/l51-wechat-commerce-gate.yml`
- Modify: `.github/workflows/l50-c2-t3a-refund-gate.yml`
- Modify: `.github/workflows/verification-baseline-audit.yml`

**Interfaces:**
- Consumes: `pnpm test:vcm1` and `node scripts/verify-consumer-identity-contract-local.cjs`.
- Produces: an early identity-contract step in each PR #117 release gate.

- [ ] **Step 1: Add early contract steps**

After dependency installation and before PostgreSQL setup, run:

```bash
pnpm test:vcm1
node scripts/verify-consumer-identity-contract-local.cjs
```

- [ ] **Step 2: Run local non-database verification**

```bash
pnpm test:vcm1
node scripts/verify-consumer-identity-contract-local.cjs
node --import tsx scripts/verify-stage-registry-local.ts
pnpm --filter @community-selection/api typecheck
git diff --check
```

- [ ] **Step 3: Run full available release verification**

With PostgreSQL configured:

```bash
pnpm verify:all
```

Require exit 0. If local PostgreSQL is unavailable, publish only after the
focused non-database checks pass and require all three community Runner gates.

- [ ] **Step 4: Publish to PR #117**

Update only the planned files on `codex/l51-real-wechat-commerce-loop`, verify
the remote head after every sequential connector commit, and do not create a
new PR.

- [ ] **Step 5: Confirm remote gates**

Require L50 refund gate, L51 WeChat commerce gate, and baseline audit to
complete successfully. Inspect full logs for any failure before changing code.
