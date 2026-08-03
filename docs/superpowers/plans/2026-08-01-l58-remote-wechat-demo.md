# L58 Remote WeChat Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide fail-closed Mac commands that expose only an isolated MOCK-payment API through a short-lived Cloudflare Quick Tunnel and generate a one-use WeChat Mini Program experience build for remote phone testing.

**Architecture:** A Node.js orchestration layer validates a tightly whitelisted local secret file, renders a private Compose JSON model for PostgreSQL and API only, owns the `cloudflared` child process, generates an ignored miniapp copy, and records bounded lifecycle state under `.tmp/remote-demo`. A separate local-only Admin command injects the strong demo token into the development Admin client; no Admin route, database port, production configuration, or real payment credential is exposed.

**Tech Stack:** Node.js ESM/CJS, Node test runner, pnpm 9.15.4, Docker Compose v2, PostgreSQL 16, Fastify, Vite/React Admin, native WeChat Mini Program, Cloudflare Quick Tunnel.

## Global Constraints

- Run on the user's Mac; the remote Windows computer only receives the experience QR code and the remote phone runs WeChat.
- Do not buy or use a server or domain, and do not modify DNS, production deployment, production data, or production secrets.
- Require a real `WECHAT_APP_ID` and `WECHAT_APP_SECRET` only for `wx.login`; keep `WECHAT_PAY_MODE=mock` and `MOCK_WECHAT_PAY=true` for every demo process.
- Never accept merchant IDs, APIv3 keys, private keys, platform certificates, real payment/refund callbacks, or a production database URL in demo configuration.
- Keep PostgreSQL unpublished, bind API and Admin host ports to `127.0.0.1`, and tunnel only the API port.
- Require `CURRENT_USER_MOCK_HEADERS_ENABLED=false`, `ADMIN_AUTH_ENABLED=true`, `ADMIN_AUTH_MODE=token`, `AUTO_PAYOUT_ENABLED=false`, `AUTO_TAX_FILING_ENABLED=false`, and `FIRST_LAUNCH_MODE=true`.
- Use a dedicated Compose project, named volumes, ignored runtime directory, and deterministic demo seed; do not copy a development database or production backup.
- Default TTL is 120 minutes; accept only 30–240 minutes.
- Cleanup may target only recorded L58 PIDs, paths, Compose project, containers, and volumes; never use `pkill`, global Docker cleanup, globs, or fuzzy volume names.
- Every behavior change follows RED → GREEN → refactor; small tasks use focused tests and module completion runs repository gates.

---

### Task 1: Whitelisted local demo configuration

**Files:**
- Create: `.env.demo.example`
- Create: `scripts/remote-demo/config.mjs`
- Create: `scripts/remote-demo/config.test.cjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: repository-root `.env.demo.local` with `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `USER_SESSION_TOKEN_SECRET`, `ADMIN_TOKEN`, optional `DEMO_API_PORT`, optional `DEMO_ADMIN_PORT`, and optional `DEMO_TTL_MINUTES`.
- Produces: `parseDemoEnv(text)`, `validateDemoConfig(values)`, `loadDemoConfig({ repoRoot })`, and a frozen config object with normalized integers and secrets kept in memory.

- [ ] **Step 1: Write failing configuration tests**

  Cover a valid 0600 file, missing required keys, unknown keys, duplicate keys, placeholders, secrets shorter than 32 characters, reused secrets, ports outside 1–65535, ports equal to each other or the daily development ports 13080/13081, TTL values below 30 or above 240, symlinks, group/world-readable permissions, and forbidden real-payment/database keys. Assert errors name only fields and never secret values.

  ```js
  assert.deepEqual(validateDemoConfig(validValues), {
    appId: 'wx1234567890abcdef',
    appSecret: 'a'.repeat(32),
    sessionTokenSecret: 'b'.repeat(32),
    adminToken: 'c'.repeat(32),
    apiPort: 13180,
    adminPort: 13181,
    ttlMinutes: 120,
  });
  assert.throws(
    () => validateDemoConfig({ ...validValues, WECHAT_MCH_ID: 'private-value' }),
    (error) => /WECHAT_MCH_ID/.test(error.message) && !/private-value/.test(error.message),
  );
  ```

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/remote-demo/config.test.cjs`

  Expected: FAIL because `config.mjs` does not exist.

- [ ] **Step 3: Implement the minimal parser and validator**

  Parse simple `KEY=value` lines without shell evaluation, reject duplicates and keys outside the exact allow-list, validate the AppID as `wx` plus 16 alphanumeric characters, require independent 32-character secrets, and use `lstat` plus POSIX mode checks before reading `.env.demo.local`.

  ```js
  const ALLOWED_KEYS = new Set([
    'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'USER_SESSION_TOKEN_SECRET',
    'ADMIN_TOKEN', 'DEMO_API_PORT', 'DEMO_ADMIN_PORT', 'DEMO_TTL_MINUTES',
  ]);
  if ((stats.mode & 0o077) !== 0) {
    throw new Error('.env.demo.local permissions must be 0600');
  }
  ```

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/remote-demo/config.test.cjs`

  Expected: all configuration and secret-redaction cases pass.

- [ ] **Step 5: Commit**

  ```bash
  git add .gitignore .env.demo.example scripts/remote-demo/config.mjs scripts/remote-demo/config.test.cjs
  git commit -m "feat(l58): validate isolated demo configuration"
  ```

### Task 2: Isolated PostgreSQL and API Compose model

**Files:**
- Create: `scripts/remote-demo/compose.mjs`
- Create: `scripts/remote-demo/compose.test.cjs`

**Interfaces:**
- Consumes: validated demo config and absolute repository/runtime paths.
- Produces: `renderDemoCompose(config, paths)` and `writeDemoCompose(model, outputPath)`; the latter creates a mode-0600 ignored JSON file accepted by Docker Compose.

- [ ] **Step 1: Write failing Compose behavior tests**

  Assert the rendered model contains only `postgres` and `api`; PostgreSQL has a named project volume and no `ports`; API depends on a healthy database, connects to host `postgres`, binds `127.0.0.1:<DEMO_API_PORT>:13080`, mounts only the current repository plus project-scoped dependency volumes, runs migrations and deterministic seed before API startup, and fixes every security flag. Assert no Admin service, production env file, host database URL, payment credential, or production volume appears.

  ```js
  assert.deepEqual(Object.keys(model.services).sort(), ['api', 'postgres']);
  assert.equal(model.services.postgres.ports, undefined);
  assert.equal(model.services.api.ports[0].host_ip, '127.0.0.1');
  assert.equal(model.services.api.environment.WECHAT_PAY_MODE, 'mock');
  assert.equal(model.services.api.environment.CURRENT_USER_MOCK_HEADERS_ENABLED, 'false');
  ```

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/remote-demo/compose.test.cjs`

  Expected: FAIL because `compose.mjs` does not exist.

- [ ] **Step 3: Implement the minimal renderer**

  Return a Compose-spec object with PostgreSQL 16, `Dockerfile.dev`, internal database credentials derived for this ephemeral project, API health check, fixed pnpm 9.15.4 bootstrap, `prisma migrate deploy`, `pnpm db:seed`, and the API dev process. Write the rendered JSON with atomic rename and 0600 permissions under `.tmp/remote-demo`.

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/remote-demo/config.test.cjs scripts/remote-demo/compose.test.cjs`

  Expected: all configuration and topology tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add scripts/remote-demo/compose.mjs scripts/remote-demo/compose.test.cjs
  git commit -m "feat(l58): isolate demo database and api topology"
  ```

### Task 3: Quick Tunnel parsing and one-use miniapp copy

**Files:**
- Create: `scripts/remote-demo/tunnel.mjs`
- Create: `scripts/remote-demo/tunnel.test.cjs`
- Create: `scripts/remote-demo/miniapp-copy.mjs`
- Create: `scripts/remote-demo/miniapp-copy.test.cjs`
- Modify: `apps/miniapp/config.js`

**Interfaces:**
- Consumes: `cloudflared` output chunks, one validated `https://*.trycloudflare.com` origin, validated AppID, original `apps/miniapp`, runtime directory, and secret values used only for exclusion scanning.
- Produces: `extractQuickTunnelUrls(text)`, `resolveUniqueQuickTunnelUrl(chunks)`, and `generateMiniappCopy({ sourceDir, outputDir, apiBaseUrl, appId, forbiddenValues })`.

- [ ] **Step 1: Write failing URL and copy tests**

  Require exactly one unique lowercase HTTPS Quick Tunnel origin; reject HTTP, query/fragment/path, lookalike domains, multiple different URLs, and missing URLs. Generate into a temporary directory and assert the source tree is byte-for-byte unchanged, `config.js` in the copy contains only the normalized API URL plus `remoteDemo: true`, `project.config.json` contains the real AppID and `urlCheck: false`, private project files are excluded, and AppSecret/admin/session secrets never occur in any output file.

  ```js
  assert.equal(
    resolveUniqueQuickTunnelUrl(['INF https://demo-one.trycloudflare.com']),
    'https://demo-one.trycloudflare.com',
  );
  assert.throws(
    () => resolveUniqueQuickTunnelUrl([
      'https://one.trycloudflare.com', 'https://two.trycloudflare.com',
    ]),
    /exactly one/i,
  );
  ```

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/remote-demo/tunnel.test.cjs scripts/remote-demo/miniapp-copy.test.cjs`

  Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement URL validation and safe copy generation**

  Use `URL` plus exact hostname suffix validation, reject credentials and non-origin components, copy with an explicit exclusion filter, rewrite only the copied centralized config, generate project config from literals, scan every regular output file for forbidden secret values, and delete the incomplete output directory on any error.

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/remote-demo/tunnel.test.cjs scripts/remote-demo/miniapp-copy.test.cjs`

  Expected: all tunnel and copy isolation tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/miniapp/config.js scripts/remote-demo/tunnel.mjs scripts/remote-demo/tunnel.test.cjs scripts/remote-demo/miniapp-copy.mjs scripts/remote-demo/miniapp-copy.test.cjs
  git commit -m "feat(l58): generate one-use miniapp experience copy"
  ```

### Task 4: Bounded start, stop, rollback, and automatic expiry

**Files:**
- Create: `scripts/remote-demo/lifecycle.mjs`
- Create: `scripts/remote-demo/lifecycle.test.cjs`
- Create: `scripts/remote-demo/start.mjs`
- Create: `scripts/remote-demo/stop.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 config, Task 2 Compose writer, Task 3 tunnel/copy functions, command runner, child-process launcher, health probe, clock, signal registration, and state file under `.tmp/remote-demo/state.json`.
- Produces: `startRemoteDemo(deps)`, `cleanupRemoteDemo(state, deps)`, `validateRuntimeState(state, paths)`, CLI `pnpm demo:remote:start`, and CLI `pnpm demo:remote:stop`.

- [ ] **Step 1: Write failing lifecycle tests**

  Test the observable sequence: prerequisites → free loopback ports → Compose up/wait → local health → tunnel URL → public health → copy → public summary. For each failure boundary, assert later exposure/generation never occurs and prior resources roll back. Test repeated start, repeated stop, 120-minute expiry, custom 30/240-minute boundaries, SIGINT/SIGTERM cleanup, exact project/path validation, PID command identity validation, and refusal to signal an unrelated process. Assert logs include only URL, paths, deadline, and instructions and contain no secret values.

  ```js
  await assert.rejects(
    startRemoteDemo({ ...deps, probePublicHealth: async () => false }),
    /public health/i,
  );
  assert.deepEqual(events, [
    'prerequisites', 'ports', 'compose-up', 'local-health',
    'tunnel-start', 'public-health', 'tunnel-stop', 'compose-down',
  ]);
  ```

- [ ] **Step 2: Run RED**

  Run: `node --test scripts/remote-demo/lifecycle.test.cjs`

  Expected: FAIL because lifecycle and CLI modules do not exist.

- [ ] **Step 3: Implement orchestration and concrete adapters**

  Validate macOS, Node, pnpm, Docker Compose, `cloudflared`, and a standard WeChat Developer Tools installation. Spawn `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>` without a shell, capture only enough output to resolve one URL, verify `/api/health` locally and publicly, write mode-0600 state atomically, and remain foreground until TTL or signal. Cleanup first verifies the constant project name `community-selection-l58-demo`, every path is below `.tmp/remote-demo`, and each recorded PID command contains the expected executable/arguments; it then stops only matched PIDs, runs `docker compose -p community-selection-l58-demo -f <recorded-file> down --volumes --remove-orphans`, and deletes only recorded generated paths.

- [ ] **Step 4: Run GREEN**

  Run: `node --test scripts/remote-demo/*.test.cjs`

  Expected: all rollback, idempotency, timeout, PID, path, and redaction cases pass.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json scripts/remote-demo/lifecycle.mjs scripts/remote-demo/lifecycle.test.cjs scripts/remote-demo/start.mjs scripts/remote-demo/stop.mjs
  git commit -m "feat(l58): orchestrate expiring remote demo"
  ```

### Task 5: Local-only Admin token support and demo payment copy

**Files:**
- Create: `scripts/remote-demo/admin.mjs`
- Create: `apps/admin/src/shared/api/demo-admin-auth.ts`
- Create: `apps/admin/src/shared/api/demo-admin-auth.test.ts`
- Modify: `apps/admin/src/shared/api/admin-api.ts`
- Modify: `apps/admin/src/api/adminRequest.ts`
- Modify: `apps/admin/src/types.d.ts`
- Modify: `apps/miniapp/pages/orders/confirm/index.js`
- Modify: `apps/miniapp/pages/orders/confirm/index.wxml`
- Create: `apps/miniapp/pages/orders/confirm/remote-demo.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: validated `.env.demo.local`, running loopback API, `import.meta.env.DEV`, `VITE_ADMIN_TOKEN`, and copied `config.remoteDemo`.
- Produces: `demoAdminAuthHeaders({ dev, token })`, CLI `pnpm demo:remote:admin`, token-bearing local Admin requests only in development, and visible “演示支付，不会真实扣款” copy only in generated remote-demo builds.

- [ ] **Step 1: Write failing Admin and miniapp behavior tests**

  Assert a trimmed token becomes `x-admin-token` only when `dev === true`; production or empty-token inputs produce no header. Load the confirm page with `config.remoteDemo=true` and assert its data selects the demo notice/payment label; with `false`, assert normal payment wording and no no-charge notice.

  ```ts
  expect(demoAdminAuthHeaders({ dev: true, token: ' strong-token ' }))
    .toEqual({ 'x-admin-token': 'strong-token' });
  expect(demoAdminAuthHeaders({ dev: false, token: 'strong-token' }))
    .toEqual({});
  ```

- [ ] **Step 2: Run RED**

  Run: `pnpm --filter @community-selection/admin exec vitest run src/shared/api/demo-admin-auth.test.ts && node --test apps/miniapp/pages/orders/confirm/remote-demo.test.cjs`

  Expected: FAIL because the helper and page demo state do not exist.

- [ ] **Step 3: Implement minimal local Admin and page presentation**

  Add the helper to both Admin request entrypoints, expose `VITE_ADMIN_TOKEN` in the type declaration, and make `admin.mjs` load the validated secret file before spawning Vite on `127.0.0.1:<DEMO_ADMIN_PORT>` with the loopback API URL. In the miniapp page, initialize presentation from centralized `config.remoteDemo`; do not change payment execution, amount, refund, or order rules.

- [ ] **Step 4: Run GREEN**

  Run: `pnpm --filter @community-selection/admin exec vitest run src/shared/api/demo-admin-auth.test.ts && node --test apps/miniapp/pages/orders/confirm/remote-demo.test.cjs apps/miniapp/utils/payment.test.cjs`

  Expected: local token behavior, demo copy, and existing runtime-controlled payment tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json scripts/remote-demo/admin.mjs apps/admin/src/shared/api/demo-admin-auth.ts apps/admin/src/shared/api/demo-admin-auth.test.ts apps/admin/src/shared/api/admin-api.ts apps/admin/src/api/adminRequest.ts apps/admin/src/types.d.ts apps/miniapp/pages/orders/confirm/index.js apps/miniapp/pages/orders/confirm/index.wxml apps/miniapp/pages/orders/confirm/remote-demo.test.cjs
  git commit -m "feat(l58): support local demo administration"
  ```

### Task 6: Operator runbook and module verification

**Files:**
- Create: `docs/runbooks/l58-remote-wechat-demo.md`
- Create: `docs/reviews/l58-remote-wechat-demo.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the three demo commands, experience-member access, WeChat Developer Tools 3.17.0, two WeChat accounts for a two-person group, and the approved fallback to screen sharing.
- Produces: a no-secret operator checklist and an evidence record that distinguishes automated verification from still-pending real Mac/phone acceptance.

- [ ] **Step 1: Write the operator runbook**

  Document `cp .env.demo.example .env.demo.local`, `chmod 600 .env.demo.local`, local secret generation without printing values into chat, prerequisite installation checks, `pnpm demo:remote:start`, opening only the printed generated directory in WeChat Developer Tools, uploading a new experience version, enabling phone debug mode, `pnpm demo:remote:admin`, the purchase/group/order/refund script, `pnpm demo:remote:stop`, and verification that the old URL fails. State that every restart creates a new URL and requires a new experience upload/QR code.

- [ ] **Step 2: Record explicit fail-closed fallbacks**

  For missing phone debug mode, Quick Tunnel instability, upload failure, login failure, runtime reporting `wechat`, unknown traffic, or expiry, require stop and screen sharing. Do not suggest IP/localhost allow-list bypasses, public router ports, disabled Admin auth, mock user headers, or production credentials.

- [ ] **Step 3: Run focused module verification**

  Run: `node --test scripts/remote-demo/*.test.cjs apps/miniapp/pages/orders/confirm/remote-demo.test.cjs apps/miniapp/utils/payment.test.cjs`

  Run: `pnpm --filter @community-selection/admin exec vitest run src/shared/api/demo-admin-auth.test.ts`

  Run: `git diff --check`

  Expected: all L58 focused tests pass and the diff has no whitespace errors.

- [ ] **Step 4: Run repository gates**

  Run: `pnpm lint`

  Run: `pnpm typecheck`

  Run: `pnpm test`

  Run: `pnpm build`

  Expected: every required repository gate exits zero.

- [ ] **Step 5: Validate the rendered topology without starting Cloudflare or WeChat**

  With a temporary non-secret fixture environment, render the Compose JSON and run `docker compose -p community-selection-l58-demo -f <rendered-file> config --format json`; assert two services only, no PostgreSQL published port, loopback API binding, MOCK flags, and no Admin service. Delete the fixture afterward.

- [ ] **Step 6: Commit**

  ```bash
  git add README.md docs/runbooks/l58-remote-wechat-demo.md docs/reviews/l58-remote-wechat-demo.md
  git commit -m "docs(l58): add remote demo operator runbook"
  ```

## Plan self-review

- Spec sections 4–7 map to Tasks 1–5; automated and manual acceptance map to Task 6.
- The only public endpoint is the generated Quick Tunnel API origin; Admin and PostgreSQL remain loopback-only/unpublished.
- Real WeChat credentials are limited to login; every real payment/merchant field is rejected before Docker or Cloudflare starts.
- State, PID, Compose project, path, and volume cleanup have exact validation and idempotency tests; no global cleanup command exists.
- The generated miniapp copy is the only place receiving the random URL and `remoteDemo=true`; tracked source never receives a tunnel URL or AppSecret.
- Automated completion does not claim real remote-phone acceptance; the review must keep that item pending until a Mac and two phones execute the runbook.
- No placeholder steps or undefined cross-task interfaces remain.
