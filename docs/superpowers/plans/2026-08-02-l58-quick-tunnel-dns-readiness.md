# L58 Quick Tunnel DNS Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the L58 launcher from poisoning macOS DNS with an early Quick Tunnel lookup by withholding the tunnel origin until connector registration and public DNS publication are both proven.

**Architecture:** Extend the existing `waitForQuickTunnel` state machine instead of adding another lifecycle phase. It accumulates the owned child's output, requires one validated URL plus the registration log, and then polls an injected direct DNS resolver before returning `{ pid, url }`; all work shares the existing 30-second tunnel timeout.

**Tech Stack:** Node.js 20.19+/22.12+, ESM, `node:dns/promises`, `node:test`, Cloudflare Quick Tunnel.

## Global Constraints

- Keep the Quick Tunnel startup deadline at 30 seconds and the public API readiness deadline at 90 seconds.
- Never make an HTTP request to the fresh hostname before the DNS readiness gate succeeds.
- Preserve exact validation of one HTTPS `*.trycloudflare.com` origin.
- Preserve `/api/health`, `/api/public/runtime`, and `payment_mode=mock` fail-closed checks.
- Preserve cleanup of containers, network, temporary PostgreSQL data, state, and generated Mini Program files while retaining dependency cache volumes.
- Add no production deployment, real payment, persistent public exposure, Cloudflare credentials, or general DNS subsystem.

---

### Task 1: Make Quick Tunnel readiness include registration and DNS publication

**Files:**
- Modify: `scripts/remote-demo/lifecycle.test.cjs`
- Modify: `scripts/remote-demo/start.mjs`

**Interfaces:**
- Consumes: `extractQuickTunnelUrls(text: string): string[]` from `scripts/remote-demo/tunnel.mjs`.
- Produces: `waitForQuickTunnel(child, options): Promise<{ pid: number, url: string }>` where `options.resolveHostname(hostname)` is injectable and production defaults to Cloudflare public DNS.

- [ ] **Step 1: Replace the URL-only acceptance test with a failing three-condition regression test**

```js
test('CLI exposes a Quick Tunnel only after URL, registration, and public DNS', async () => {
  const { waitForQuickTunnel } = await import('./start.mjs');
  const child = new EventEmitter();
  child.pid = 345;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let dnsRelease;
  const dnsReady = new Promise((resolve) => {
    dnsRelease = resolve;
  });
  const dnsHosts = [];
  let settled = false;

  const pending = waitForQuickTunnel(child, {
    timeoutMs: 1_000,
    resolveHostname: async (hostname) => {
      dnsHosts.push(hostname);
      return dnsReady;
    },
  });
  pending.then(() => {
    settled = true;
  });

  child.stderr.write('INF https://demo-child.trycloudflare.com\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(dnsHosts, []);

  child.stderr.write('INF Registered tunnel connection connIndex=0\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(dnsHosts, ['demo-child.trycloudflare.com']);

  dnsRelease(['104.16.230.132']);
  assert.deepEqual(await pending, {
    pid: 345,
    url: 'https://demo-child.trycloudflare.com',
  });
});
```

- [ ] **Step 2: Run the focused regression test and verify RED**

Run:

```bash
node --test --test-name-pattern='exposes a Quick Tunnel only' scripts/remote-demo/lifecycle.test.cjs
```

Expected: FAIL because the current function resolves as soon as it sees the URL and never calls `resolveHostname`.

- [ ] **Step 3: Add a transient DNS miss regression test**

```js
test('CLI retries a transient Quick Tunnel DNS miss before exposing the URL', async () => {
  const { waitForQuickTunnel } = await import('./start.mjs');
  const child = new EventEmitter();
  child.pid = 346;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let attempts = 0;

  const pending = waitForQuickTunnel(child, {
    timeoutMs: 1_000,
    dnsRetryIntervalMs: 1,
    resolveHostname: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('not published');
        error.code = 'ENOTFOUND';
        throw error;
      }
      return ['104.16.230.132'];
    },
  });
  child.stderr.write(
    'INF https://demo-child.trycloudflare.com\n' +
      'INF Registered tunnel connection connIndex=0\n',
  );

  assert.deepEqual(await pending, {
    pid: 346,
    url: 'https://demo-child.trycloudflare.com',
  });
  assert.equal(attempts, 2);
});
```

- [ ] **Step 4: Implement the minimal three-condition state machine**

In `start.mjs`, import `Resolver` from `node:dns/promises`, create one production resolver with servers `1.1.1.1` and `1.0.0.1`, and default `resolveHostname` to `resolver.resolve4(hostname)`.

Update `waitForQuickTunnel` to:

```js
export function waitForQuickTunnel(
  child,
  {
    timeoutMs = 30_000,
    dnsRetryIntervalMs = 500,
    resolveHostname = defaultResolveQuickTunnelHostname,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const urls = new Set();
    let output = '';
    let registered = false;
    let dnsCheckPending = false;
    let dnsRetryTimer = null;
    let settled = false;

    const checkDns = async () => {
      if (settled || dnsCheckPending || !registered || urls.size !== 1) return;
      dnsCheckPending = true;
      const url = [...urls][0];
      try {
        const addresses = await resolveHostname(new URL(url).hostname);
        if (!Array.isArray(addresses) || addresses.length === 0) {
          throw new Error('Quick Tunnel public DNS returned no addresses');
        }
        finish(null, { pid: child.pid, url });
      } catch {
        dnsCheckPending = false;
        if (!settled) dnsRetryTimer = setTimeout(checkDns, dnsRetryIntervalMs);
      }
    };
```

`onData` appends bounded output, rescans it for the validated URL, records
`Registered tunnel connection`, rejects multiple URLs, and invokes
`void checkDns()` only when both log conditions exist. `finish` clears both
the global deadline and DNS retry timer and removes all listeners. The timeout
message must identify URL/registration/public-DNS readiness, while an early
child exit must state that the tunnel exited before becoming ready.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern='Quick Tunnel' scripts/remote-demo/lifecycle.test.cjs
```

Expected: all matching tests PASS, including multiple-URL and early-exit tests.

- [ ] **Step 6: Run the complete L58 test set**

Run:

```bash
pnpm test:remote-demo
```

Expected: all tests PASS with no unhandled rejection, open timer, or warning.

- [ ] **Step 7: Commit the tested implementation**

```bash
git add scripts/remote-demo/start.mjs scripts/remote-demo/lifecycle.test.cjs
git commit -m "fix(l58): gate quick tunnel on public DNS"
```

---

### Task 2: Verify repository gates and publish the existing Draft PR update

**Files:**
- Verify only: all tracked files
- Update remotely: branch `codex/l58-remote-demo`, PR #123

**Interfaces:**
- Consumes: Task 1 implementation commit and the preceding design/plan commits.
- Produces: a fast-forward update of PR #123 with passing L58 and repository gates.

- [ ] **Step 1: Run static project gates**

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Expected: all commands exit 0; pre-existing Vite/Ant Design warnings may remain but no new error is accepted.

- [ ] **Step 2: Run the full test command in the repository's isolated PostgreSQL gate or GitHub L58 gate**

```bash
pnpm test
```

Expected: all non-database tests pass locally. If local PostgreSQL is absent, the GitHub L58 workflow must provide isolated PostgreSQL and pass the complete test command before completion is claimed.

- [ ] **Step 3: Review the exact change**

```bash
git diff f1ec09d..HEAD --check
git diff --stat f1ec09d..HEAD
git status --short
```

Expected: no whitespace errors; only the L58 design, plan, readiness implementation, and regression tests are changed; worktree is clean.

- [ ] **Step 4: Fast-forward the existing PR branch and monitor gates**

Push `codex/l58-remote-demo` without force. If local HTTPS credentials are unavailable, create an equivalent commit from the verified tree through the connected GitHub app and update the ref only when remote HEAD still equals `efdfe003ffbbcabed2f63de5587c9264b10b918c`.

Expected: PR #123 remains Draft and mergeable; L51, L52, L57, and L58 workflows all finish successfully.
