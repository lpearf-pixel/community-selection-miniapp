# A3 Production Launch Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, single-server production deployment and acceptance package for the existing purchase, WeChat Pay, refund, group-buy, and pickup flows.

**Architecture:** Build immutable API and Caddy/Admin images from the pnpm monorepo, then run them with PostgreSQL on one private Docker Compose network. Caddy terminates HTTPS for separate API and Admin domains, the API remains the only scheduler process, PostgreSQL advisory locks remain the duplicate-execution fence, and migrations run as a one-shot dependency before API startup. Operational scripts validate configuration, smoke-test public endpoints, and create encrypted PostgreSQL backups with explicit restore confirmation.

**Tech Stack:** Node.js 22, pnpm 9.15.4, TypeScript, Fastify, Prisma 6.19.3, PostgreSQL 16, Docker Compose v2, Caddy 2.8, Bash, GnuPG.

## Global Constraints

- Keep the existing development `docker-compose.yml` unchanged.
- Target Ubuntu 22.04 or 24.04 with Docker Engine and Docker Compose v2.
- First production host is one Linux server; PostgreSQL must not publish a host port.
- Do not add Redis, Kubernetes, MQ, Elasticsearch, or a cloud database.
- Production must use real WeChat login/payment/refund configuration and must reject mock payment or mock identity headers.
- Production Admin authentication must use session mode with a strong, independent TOTP encryption key.
- Automatic payout and automatic tax filing must remain disabled.
- The API service runs one instance in this release; PostgreSQL advisory locks remain the second duplicate-execution boundary.
- Images and third-party base images must be version-tagged; rollback must select an earlier application image tag.
- Database changes are forward-only in normal rollback; restoring a backup requires an explicit operator action.

---

### Task 1: Fail-closed runtime configuration

**Files:**
- Create: `packages/config/src/index.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `scripts/validate-env.ts`
- Create: `.env.production.example`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`
- Produces: `validateRuntimeConfig(env?: NodeJS.ProcessEnv): void`
- Produces: a production environment template using `/run/secrets/*` certificate paths and separate `API_DOMAIN` / `ADMIN_DOMAIN`

- [ ] **Step 1: Write failing configuration tests**

```ts
it('rejects every production-only unsafe switch', () => {
  expect(() => validateRuntimeConfig({
    ...validProductionEnv,
    MOCK_WECHAT_PAY: 'true',
    CURRENT_USER_MOCK_HEADERS_ENABLED: 'true',
  })).toThrow();
});
```

- [ ] **Step 2: Run RED**

Run: `vitest run packages/config/src/index.test.ts`

Expected: FAIL because current runtime validation accepts unsafe production switches.

- [ ] **Step 3: Implement one shared validator**

Implement deterministic validation for production Admin session mode, strong secrets, real WeChat configuration, HTTPS callback/domain values, disabled automatic payout/tax features, and container-safe secret paths. Make `scripts/validate-env.ts` call the shared validator so preflight and API startup enforce the same contract.

- [ ] **Step 4: Run GREEN**

Run: `vitest run packages/config/src/index.test.ts && pnpm --filter @community-selection/config typecheck`

Expected: all configuration cases pass and types compile.

- [ ] **Step 5: Commit**

```bash
git add packages/config scripts/validate-env.ts .env.production.example
git commit -m "feat(prod): enforce production runtime configuration"
```

### Task 2: Immutable images, HTTPS edge, and private Compose network

**Files:**
- Create: `Dockerfile.production`
- Create: `Caddyfile.production`
- Create: `docker-compose.production.yml`
- Modify: `.dockerignore`
- Modify: `.gitignore`
- Create: `scripts/production/compose-contract.test.cjs`

**Interfaces:**
- Consumes: `.env.production`
- Produces: Docker targets `api`, `edge`, and `ops`
- Produces: one-shot `migrate`, long-running `api`, HTTPS `edge`, private `postgres`, and manual-profile `backup`

- [ ] **Step 1: Write a failing executable Compose contract**

```js
test('production topology renders without published PostgreSQL ports', async () => {
  const result = await renderProductionCompose(validFixtureEnv);
  assert.deepEqual(result.services.postgres.ports, undefined);
  assert.equal(result.services.api.depends_on.migrate.condition, 'service_completed_successfully');
});
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/production/compose-contract.test.cjs`

Expected: FAIL because the production Dockerfile, Caddyfile, and Compose topology do not exist.

- [ ] **Step 3: Implement the production topology**

Build workspace dependencies and Prisma once, copy only runtime artifacts into the API image, serve Admin static assets from the Caddy image, proxy Admin `/api/*` and the API domain to `api:13080`, and mount WeChat key/certificate files read-only. Add health checks and ensure only Caddy publishes `80/443`.

- [ ] **Step 4: Run GREEN and image build verification**

Run: `node --test scripts/production/compose-contract.test.cjs`

Runner command: `docker compose --env-file .env.production.ci -f docker-compose.production.yml config && docker compose --env-file .env.production.ci -f docker-compose.production.yml build api edge ops`

Expected: contract passes, Compose renders, and all targets build.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.production Caddyfile.production docker-compose.production.yml .dockerignore .gitignore scripts/production
git commit -m "feat(prod): add immutable single-server topology"
```

### Task 3: Encrypted backups and guarded restore

**Files:**
- Modify: `scripts/pg-backup.sh`
- Modify: `scripts/pg-restore.sh`
- Create: `scripts/production/backup-restore.test.cjs`

**Interfaces:**
- Consumes: `DATABASE_URL`, `BACKUP_DIR`, and `BACKUP_ENCRYPTION_PASSPHRASE_FILE`
- Produces: `community_selection_<UTC timestamp>.dump.gpg`
- Consumes for restore: `BACKUP_FILE` and `RESTORE_CONFIRM=RESTORE_COMMUNITY_SELECTION`

- [ ] **Step 1: Write failing behavior tests with isolated fake executables**

```js
test('restore refuses to decrypt without the exact confirmation token', async () => {
  const result = await runRestore({ RESTORE_CONFIRM: 'wrong' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /RESTORE_COMMUNITY_SELECTION/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/production/backup-restore.test.cjs`

Expected: FAIL because backups are plaintext and restore has no confirmation fence.

- [ ] **Step 3: Implement encrypted backup, retention, and guarded restore**

Pipe custom-format `pg_dump` through GnuPG symmetric AES-256 encryption using a read-only passphrase file, write atomically, delete encrypted backups older than `BACKUP_RETENTION_DAYS`, verify decryptability, and require the exact restore confirmation before piping to `pg_restore`.

- [ ] **Step 4: Run GREEN**

Run: `node --test scripts/production/backup-restore.test.cjs`

Expected: encrypted output, retention behavior, failure cleanup, and restore confirmation all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/pg-backup.sh scripts/pg-restore.sh scripts/production/backup-restore.test.cjs
git commit -m "feat(prod): encrypt backups and guard restore"
```

### Task 4: Preflight, deployment, rollback, and public smoke checks

**Files:**
- Create: `scripts/production/preflight.mjs`
- Create: `scripts/production/preflight.test.cjs`
- Create: `scripts/production/deploy.sh`
- Create: `scripts/production/rollback.sh`
- Create: `scripts/production/smoke.mjs`
- Create: `scripts/production/smoke.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces commands: `prod:preflight`, `prod:smoke`, `prod:deploy`, `prod:rollback`, `prod:backup`, `prod:restore`
- `preflight` verifies environment, local secret files, Compose v2 availability, and topology rendering
- `smoke` verifies HTTPS API health, Admin HTML, HTTP-to-HTTPS behavior, and rejects unexpected response shapes

- [ ] **Step 1: Write failing preflight and smoke behavior tests**

```js
test('smoke rejects a 200 response with the wrong API envelope', async () => {
  await assert.rejects(() => smoke({ apiBaseUrl }), /health envelope/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test scripts/production/preflight.test.cjs scripts/production/smoke.test.cjs`

Expected: FAIL because the public operational interfaces do not exist.

- [ ] **Step 3: Implement minimal operational commands**

Preflight must never print secret values. Deploy must run preflight, build a versioned image tag, take a pre-migration backup when a database already exists, run migration, start services, and smoke-test. Rollback must require an explicit previous `IMAGE_TAG`, avoid reversing migrations, and run smoke checks after switching images.

- [ ] **Step 4: Run GREEN**

Run: `node --test scripts/production/preflight.test.cjs scripts/production/smoke.test.cjs && pnpm prod:preflight -- --fixture`

Expected: failure branches and the safe fixture path pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/production package.json
git commit -m "feat(prod): add preflight deploy rollback and smoke commands"
```

### Task 5: Production gate and operator acceptance package

**Files:**
- Create: `.github/workflows/l52-production-readiness.yml`
- Create: `docs/ops/single-server-production-deployment.md`
- Modify: `docs/ops/postgres-backup-restore.md`
- Modify: `docs/production-checklist.md`
- Create: `docs/ops/purchase-group-production-acceptance.md`
- Create: `docs/reviews/l52-production-readiness.md`

**Interfaces:**
- Produces: L52 Runner evidence for tests, types, Compose rendering, image builds, and full historical gates
- Produces: acceptance evidence rows for login, normal purchase, group join, JSAPI payment, callbacks, successful group, failed-group refund, pickup, alert review, backup, restore drill, and rollback

- [ ] **Step 1: Add the L52 workflow and operator documents**

The workflow must use the community self-hosted Docker runner, create only synthetic CI secrets, render the production topology, build all images, run production-focused tests, and then run the repository’s existing lint/typecheck/test/build plus `verify:all`.

- [ ] **Step 2: Run documentation and workflow checks**

Run: `git diff --check && node --test scripts/production/*.test.cjs`

Expected: no malformed diffs and all production behavior tests pass.

- [ ] **Step 3: Run full local verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: all commands exit zero.

- [ ] **Step 4: Review the approved specification line by line**

Confirm the topology, fail-closed switches, scheduler boundary, migration order, HTTPS, backup encryption/retention, restore drill, rollback, Ubuntu instructions, and business acceptance checklist each have executable or documented evidence.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/l52-production-readiness.yml docs
git commit -m "docs(prod): add launch and acceptance runbook"
```

### Task 6: Publish a protected Draft PR

**Files:**
- No new repository files unless verification exposes a defect.

**Interfaces:**
- Consumes: remote `stable/l50-a3-4-business-base` head SHA
- Produces: remote branch `codex/l52-production-readiness` and a Draft PR

- [ ] **Step 1: Re-run completion verification**

Run: focused production tests, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `git diff --check`.

- [ ] **Step 2: Review the A3-only diff**

Exclude the local L51 reconstruction commit; publish only paths changed after local baseline commit `8d28aff`.

- [ ] **Step 3: Create the remote branch from the current stable SHA**

Stop if the stable branch head has drifted since the final pre-publish read.

- [ ] **Step 4: Publish one or more intentional commits and open a Draft PR**

The PR body must state production is not yet live, real secrets are absent, real server/domain acceptance remains pending, and the L52 Runner is the build/Compose authority.

- [ ] **Step 5: Track the L52 and existing affected gates**

Do not mark Ready or merge until the final remote head is unchanged and every required Runner exits successfully.
