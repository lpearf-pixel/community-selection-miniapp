# L53-A First-Launch Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production fail closed unless first-launch mode explicitly disables membership, coupons, cash rewards, withdrawals, and all payout/tax automation.

**Architecture:** Extend the existing central runtime validator instead of adding a second policy engine. Docker Compose supplies fixed safe values to API and migration containers, and production preflight reuses the same validator so deployment and runtime enforce one contract.

**Tech Stack:** TypeScript, Vitest, Node.js, Docker Compose, existing `@community-selection/config` package.

## Global Constraints

- Baseline is `47093159a5f55801a2c27316c6ca5e25749dcbae`.
- Production must set `FIRST_LAUNCH_MODE=true`.
- Production must explicitly set `MEMBERSHIP_ENABLED=false`, `COUPONS_ENABLED=false`, `CASH_REWARDS_ENABLED=false`, and `WITHDRAWALS_ENABLED=false`.
- Existing payout, transfer, and tax automation switches must remain false.
- Missing high-risk switches fail closed.
- No membership, coupon, or promoter behavior is implemented in L53-A.
- Follow red-green TDD and do not write production code before the failing test is observed.

---

### Task 1: Define the first-launch runtime contract

**Files:**
- Modify: `packages/config/src/index.test.ts`
- Modify: `packages/config/src/index.ts`

**Interfaces:**
- Consumes: `validateRuntimeConfig(env: NodeJS.ProcessEnv): void`
- Produces: validation of `FIRST_LAUNCH_MODE`, `MEMBERSHIP_ENABLED`, `COUPONS_ENABLED`, `CASH_REWARDS_ENABLED`, and `WITHDRAWALS_ENABLED`

- [ ] **Step 1: Add the safe switches to the valid production fixture**

Add these entries to `validProductionEnv`:

```ts
FIRST_LAUNCH_MODE: 'true',
MEMBERSHIP_ENABLED: 'false',
COUPONS_ENABLED: 'false',
CASH_REWARDS_ENABLED: 'false',
WITHDRAWALS_ENABLED: 'false',
```

- [ ] **Step 2: Write failing production-policy tests**

Add:

```ts
it('requires the explicit first-launch operating mode in production', () => {
  for (const value of [undefined, 'false']) {
    expect(() =>
      validateRuntimeConfig({
        ...validProductionEnv,
        FIRST_LAUNCH_MODE: value,
      }),
    ).toThrow(/FIRST_LAUNCH_MODE/);
  }
});

it.each([
  ['MEMBERSHIP_ENABLED', 'true'],
  ['COUPONS_ENABLED', 'true'],
  ['CASH_REWARDS_ENABLED', 'true'],
  ['WITHDRAWALS_ENABLED', 'true'],
])('rejects first-launch capability %s=%s', (key, value) => {
  expect(() =>
    validateRuntimeConfig({ ...validProductionEnv, [key]: value }),
  ).toThrow(new RegExp(key));
});

it.each([
  'MEMBERSHIP_ENABLED',
  'COUPONS_ENABLED',
  'CASH_REWARDS_ENABLED',
  'WITHDRAWALS_ENABLED',
])('fails closed when %s is missing', (key) => {
  const env = { ...validProductionEnv };
  delete env[key];
  expect(() => validateRuntimeConfig(env)).toThrow(new RegExp(key));
});
```

- [ ] **Step 3: Run the targeted test and verify RED**

Run:

```bash
pnpm --filter @community-selection/config test -- src/index.test.ts
```

Expected: the new tests fail because the validator does not inspect these switches.

- [ ] **Step 4: Implement the minimum validator policy**

In `packages/config/src/index.ts`, add:

```ts
const firstLaunchDisabledKeys = [
  'MEMBERSHIP_ENABLED',
  'COUPONS_ENABLED',
  'CASH_REWARDS_ENABLED',
  'WITHDRAWALS_ENABLED',
] as const;
```

Inside the production block, require the mode and exact false values:

```ts
if (env.FIRST_LAUNCH_MODE !== 'true') {
  problems.push('Production requires FIRST_LAUNCH_MODE=true');
}
for (const key of firstLaunchDisabledKeys) {
  if (env[key] !== 'false') {
    problems.push(`Production first launch requires ${key}=false`);
  }
}
```

- [ ] **Step 5: Run targeted and package tests and verify GREEN**

Run:

```bash
pnpm --filter @community-selection/config test -- src/index.test.ts
pnpm --filter @community-selection/config test
```

Expected: all configuration tests pass with zero failures.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/index.test.ts packages/config/src/index.ts
git commit -m "feat(l53): enforce first-launch runtime policy"
```

---

### Task 2: Wire the immutable production topology

**Files:**
- Modify: `.env.production.example`
- Modify: `docker-compose.production.yml`
- Modify: `scripts/production/preflight.test.cjs`

**Interfaces:**
- Consumes: environment variables validated by `validateRuntimeConfig`
- Produces: the same safe first-launch values for both `migrate` and `api` through `x-api-environment`

- [ ] **Step 1: Write a failing Compose contract test**

In `scripts/production/preflight.test.cjs`, read `docker-compose.production.yml` and add:

```js
test('pins every first-launch capability off in the production API environment', () => {
  for (const line of [
    'FIRST_LAUNCH_MODE: "true"',
    'MEMBERSHIP_ENABLED: "false"',
    'COUPONS_ENABLED: "false"',
    'CASH_REWARDS_ENABLED: "false"',
    'WITHDRAWALS_ENABLED: "false"',
  ]) {
    assert.match(productionCompose, new RegExp(line.replace(/[.*+?^$()|[\]\\]/g, '\\$&')));
  }
});
```

Use the file's existing `assert`, `fs`, and path conventions; bind `productionCompose` once to the repository-root Compose content.

- [ ] **Step 2: Run the production contract test and verify RED**

Run:

```bash
node --test scripts/production/preflight.test.cjs
```

Expected: failure naming the first missing `FIRST_LAUNCH_MODE` line.

- [ ] **Step 3: Add documented safe values**

Append under the existing production safety switches in `.env.production.example`:

```dotenv
FIRST_LAUNCH_MODE=true
MEMBERSHIP_ENABLED=false
COUPONS_ENABLED=false
CASH_REWARDS_ENABLED=false
WITHDRAWALS_ENABLED=false
```

- [ ] **Step 4: Pin the same values in the shared API environment**

Add under `x-api-environment` in `docker-compose.production.yml`:

```yaml
  FIRST_LAUNCH_MODE: "true"
  MEMBERSHIP_ENABLED: "false"
  COUPONS_ENABLED: "false"
  CASH_REWARDS_ENABLED: "false"
  WITHDRAWALS_ENABLED: "false"
```

- [ ] **Step 5: Run production contracts and verify GREEN**

Run:

```bash
node --test scripts/production/*.test.cjs
docker compose --env-file .env.production.example --profile '*' -f docker-compose.production.yml config --quiet
```

Expected: Node tests pass and Compose exits 0.

- [ ] **Step 6: Commit**

```bash
git add .env.production.example docker-compose.production.yml scripts/production/preflight.test.cjs
git commit -m "chore(l53): pin first-launch production switches"
```

---

### Task 3: Verify repository-wide compatibility

**Files:**
- Verify only; no expected source change.

**Interfaces:**
- Consumes: Tasks 1-2
- Produces: evidence that historical release gates remain compatible

- [ ] **Step 1: Run static checks**

```bash
pnpm lint
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 2: Run full tests and build**

```bash
pnpm test
pnpm build
```

Expected: all tests pass and build exits 0; existing documented warnings may remain but no new error is accepted.

- [ ] **Step 3: Run release gates**

```bash
pnpm verify:all
git diff --check 47093159a5f55801a2c27316c6ca5e25749dcbae...HEAD
```

Expected: release gate and whitespace check exit 0.

- [ ] **Step 4: Record the next boundary**

L53-A completion only establishes production configuration guardrails. API endpoint denial and miniapp entry hiding must be implemented in the next L53-A plan after the exact server navigation and authorization files are inspected from a complete source workspace.
