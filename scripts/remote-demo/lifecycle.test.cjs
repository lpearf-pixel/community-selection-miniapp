const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const repoRoot = '/workspace/community-selection-miniapp';
const config = Object.freeze({
  appId: 'wx1234567890abcdef',
  appSecret: 'a'.repeat(32),
  sessionTokenSecret: 'b'.repeat(32),
  adminToken: 'c'.repeat(32),
  apiPort: 13180,
  adminPort: 13181,
  ttlMinutes: 120,
});

async function moduleUnderTest() {
  return import('./lifecycle.mjs');
}

function harness(overrides = {}) {
  const events = [];
  const state = { value: null };
  const deps = {
    orchestratorPid: 111,
    now: () => new Date('2026-08-01T10:00:00.000Z'),
    readState: () => state.value,
    writeState: (value) => {
      events.push('state-write');
      state.value = value;
    },
    assertPrerequisites: async () => events.push('prerequisites'),
    assertPortsAvailable: async () => events.push('ports'),
    prepareCompose: async () => {
      events.push('compose-prepare');
    },
    composeUp: async () => events.push('compose-up'),
    probeLocalApi: async () => events.push('local-health'),
    startTunnel: async () => {
      events.push('tunnel-start');
      return {
        pid: 222,
        url: 'https://demo-one.trycloudflare.com',
      };
    },
    probePublicApi: async () => events.push('public-health'),
    generateCopy: async () => events.push('copy-generate'),
    printSummary: () => events.push('summary'),
    waitForShutdown: async () => {
      events.push('wait');
      return 'ttl';
    },
    readProcessCommand: async (pid) =>
      pid === 222
        ? 'cloudflared tunnel --no-autoupdate --url http://127.0.0.1:13180'
        : null,
    killProcess: async (pid, signal) => events.push(`kill-${pid}-${signal}`),
    composeDown: async () => events.push('compose-down'),
    removeRuntime: async () => {
      events.push('runtime-remove');
      state.value = null;
    },
    ...overrides,
  };
  return { deps, events, state };
}

test('starts in fail-closed order, records a bounded state, and cleans on TTL', async () => {
  const { createRuntimePaths, startRemoteDemo } = await moduleUnderTest();
  const { deps, events, state } = harness();
  const paths = createRuntimePaths(repoRoot);

  const result = await startRemoteDemo({ config, paths, deps });

  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'ttl');
  assert.equal(state.value, null);
  assert.deepEqual(events, [
    'prerequisites',
    'ports',
    'compose-prepare',
    'compose-up',
    'local-health',
    'tunnel-start',
    'public-health',
    'copy-generate',
    'state-write',
    'summary',
    'wait',
    'kill-222-SIGTERM',
    'compose-down',
    'runtime-remove',
  ]);
});

test('rolls back exposed resources when the public API check fails', async () => {
  const { createRuntimePaths, startRemoteDemo } = await moduleUnderTest();
  const { deps, events } = harness({
    probePublicApi: async () => {
      events.push('public-health');
      throw new Error('public health unavailable');
    },
  });

  await assert.rejects(
    startRemoteDemo({
      config,
      paths: createRuntimePaths(repoRoot),
      deps,
    }),
    /public health unavailable/i,
  );
  assert.deepEqual(events, [
    'prerequisites',
    'ports',
    'compose-prepare',
    'compose-up',
    'local-health',
    'tunnel-start',
    'public-health',
    'kill-222-SIGTERM',
    'compose-down',
    'runtime-remove',
  ]);
  assert.equal(events.includes('copy-generate'), false);
  assert.equal(events.includes('state-write'), false);
});

test('rolls back when a stop signal is observed during startup', async () => {
  const { createRuntimePaths, startRemoteDemo } = await moduleUnderTest();
  const { deps, events } = harness({
    assertActive: () => {
      if (events.includes('compose-up')) throw new Error('startup interrupted by SIGTERM');
    },
  });

  await assert.rejects(
    startRemoteDemo({
      config,
      paths: createRuntimePaths(repoRoot),
      deps,
    }),
    /interrupted by SIGTERM/i,
  );
  assert.equal(events.includes('local-health'), false);
  assert.equal(events.includes('compose-down'), true);
  assert.equal(events.includes('runtime-remove'), true);
});

test('rolls back Compose resources when up creates them and then returns nonzero', async () => {
  const { createRuntimePaths, startRemoteDemo } = await moduleUnderTest();
  const { deps, events } = harness({
    composeUp: async () => {
      events.push('compose-up');
      throw new Error('docker exited with status 1');
    },
  });

  await assert.rejects(
    startRemoteDemo({
      config,
      paths: createRuntimePaths(repoRoot),
      deps,
    }),
    /docker exited with status 1/i,
  );
  assert.deepEqual(events, [
    'prerequisites',
    'ports',
    'compose-prepare',
    'compose-up',
    'compose-down',
    'runtime-remove',
  ]);
});

test('redacts configured secrets from dependency failures', async () => {
  const { createRuntimePaths, startRemoteDemo } = await moduleUnderTest();
  const { deps } = harness({
    composeUp: async () => {
      throw new Error(`docker leaked ${config.appSecret}`);
    },
  });

  await assert.rejects(
    startRemoteDemo({
      config,
      paths: createRuntimePaths(repoRoot),
      deps,
    }),
    (error) =>
      error instanceof Error &&
      error.message.includes('[REDACTED]') &&
      !error.message.includes(config.appSecret),
  );
});

test('returns the existing session without starting a second stack', async () => {
  const { createRuntimePaths, startRemoteDemo } = await moduleUnderTest();
  const paths = createRuntimePaths(repoRoot);
  const existing = {
    version: 1,
    projectName: 'community-selection-l58-demo',
    repoRoot,
    runtimeRoot: paths.runtimeRoot,
    composePath: paths.composePath,
    miniappOutputDir: paths.miniappOutputDir,
    apiPort: 13180,
    orchestratorPid: 777,
    tunnelPid: 778,
    tunnelUrl: 'https://existing.trycloudflare.com',
    startedAt: '2026-08-01T10:00:00.000Z',
    deadlineAt: '2026-08-01T12:00:00.000Z',
  };
  const { deps, events } = harness({
    readState: () => existing,
    readProcessCommand: async (pid) =>
      pid === 777
        ? 'node scripts/remote-demo/start.mjs'
        : null,
  });

  await assert.doesNotReject(async () => {
    const result = await startRemoteDemo({ config, paths, deps });
    assert.deepEqual(result, { status: 'already_running', state: existing });
  });
  assert.deepEqual(events, []);
});

test('computes exact TTL boundaries', async () => {
  const { computeDeadline } = await moduleUnderTest();
  const startedAt = new Date('2026-08-01T10:00:00.000Z');
  assert.equal(
    computeDeadline(startedAt, 30).toISOString(),
    '2026-08-01T10:30:00.000Z',
  );
  assert.equal(
    computeDeadline(startedAt, 240).toISOString(),
    '2026-08-01T14:00:00.000Z',
  );
  assert.throws(() => computeDeadline(startedAt, 29), /30.*240/);
  assert.throws(() => computeDeadline(startedAt, 241), /30.*240/);
});

test('validates exact project, runtime paths, URLs, and PIDs', async () => {
  const { createRuntimePaths, validateRuntimeState } = await moduleUnderTest();
  const paths = createRuntimePaths(repoRoot);
  const valid = {
    version: 1,
    projectName: 'community-selection-l58-demo',
    repoRoot,
    runtimeRoot: paths.runtimeRoot,
    composePath: paths.composePath,
    miniappOutputDir: paths.miniappOutputDir,
    apiPort: 13180,
    orchestratorPid: 111,
    tunnelPid: 222,
    tunnelUrl: 'https://demo-one.trycloudflare.com',
    startedAt: '2026-08-01T10:00:00.000Z',
    deadlineAt: '2026-08-01T12:00:00.000Z',
  };

  assert.deepEqual(validateRuntimeState(valid, paths), valid);
  for (const mutation of [
    { projectName: 'production' },
    { runtimeRoot: path.join(repoRoot, '..') },
    { composePath: '/tmp/foreign-compose.json' },
    { miniappOutputDir: '/tmp/foreign-miniapp' },
    { orchestratorPid: 0 },
    { tunnelPid: -1 },
    { tunnelUrl: 'https://evil.example' },
  ]) {
    assert.throws(
      () => validateRuntimeState({ ...valid, ...mutation }, paths),
      /runtime state/i,
    );
  }
});

test('never signals an unrelated tunnel PID but still takes the API stack down', async () => {
  const { cleanupRemoteDemo, createRuntimePaths } = await moduleUnderTest();
  const paths = createRuntimePaths(repoRoot);
  const { deps, events } = harness({
    readProcessCommand: async () => '/usr/bin/unrelated --important',
  });
  const state = {
    version: 1,
    projectName: 'community-selection-l58-demo',
    repoRoot,
    runtimeRoot: paths.runtimeRoot,
    composePath: paths.composePath,
    miniappOutputDir: paths.miniappOutputDir,
    apiPort: 13180,
    orchestratorPid: 111,
    tunnelPid: 222,
    tunnelUrl: 'https://demo-one.trycloudflare.com',
    startedAt: '2026-08-01T10:00:00.000Z',
    deadlineAt: '2026-08-01T12:00:00.000Z',
  };

  await assert.rejects(
    cleanupRemoteDemo(state, paths, deps),
    /PID 222.*manual/i,
  );
  assert.equal(events.some((entry) => entry.startsWith('kill-')), false);
  assert.equal(events.includes('compose-down'), true);
  assert.equal(events.includes('runtime-remove'), false);
});

test('stop is idempotent when no state exists', async () => {
  const { createRuntimePaths, requestRemoteDemoStop } = await moduleUnderTest();
  const { deps, events } = harness({ readState: () => null });
  assert.deepEqual(
    await requestRemoteDemoStop(createRuntimePaths(repoRoot), deps),
    { status: 'already_stopped' },
  );
  assert.deepEqual(events, []);
});

test('stop signals only the expected foreground orchestrator', async () => {
  const { createRuntimePaths, requestRemoteDemoStop } = await moduleUnderTest();
  const paths = createRuntimePaths(repoRoot);
  const existing = {
    version: 1,
    projectName: 'community-selection-l58-demo',
    repoRoot,
    runtimeRoot: paths.runtimeRoot,
    composePath: paths.composePath,
    miniappOutputDir: paths.miniappOutputDir,
    apiPort: 13180,
    orchestratorPid: 777,
    tunnelPid: 778,
    tunnelUrl: 'https://existing.trycloudflare.com',
    startedAt: '2026-08-01T10:00:00.000Z',
    deadlineAt: '2026-08-01T12:00:00.000Z',
  };
  const { deps, events } = harness({
    readState: () => existing,
    readProcessCommand: async (pid) =>
      pid === 777
        ? `node ${path.join(repoRoot, 'scripts/remote-demo/start.mjs')}`
        : null,
    waitUntilStopped: async () => events.push('wait-stopped'),
  });

  assert.deepEqual(await requestRemoteDemoStop(paths, deps), {
    status: 'stop_requested',
  });
  assert.deepEqual(events, ['kill-777-SIGTERM', 'wait-stopped']);
});

test('CLI prerequisites require macOS, supported Node, exact tools, and Developer Tools', async () => {
  const { assertDemoPrerequisites } = await import('./start.mjs');
  const successfulCommand = () => ({ status: 0, stdout: 'ok', stderr: '' });
  const installedApps = new Set(['/Applications/wechatwebdevtools.app']);
  const base = {
    platform: 'darwin',
    nodeVersion: '22.14.0',
    runCommand: successfulCommand,
    exists: (candidate) => installedApps.has(candidate),
  };

  assert.doesNotThrow(() => assertDemoPrerequisites(base));
  assert.throws(
    () => assertDemoPrerequisites({ ...base, platform: 'linux' }),
    /macOS/i,
  );
  assert.throws(
    () => assertDemoPrerequisites({ ...base, nodeVersion: '20.18.9' }),
    /Node.*20\.19/i,
  );
  assert.throws(
    () =>
      assertDemoPrerequisites({
        ...base,
        runCommand: (command) =>
          command === 'cloudflared'
            ? { status: 127, stdout: '', stderr: 'missing' }
            : successfulCommand(),
      }),
    /cloudflared/i,
  );
  assert.throws(
    () => assertDemoPrerequisites({ ...base, exists: () => false }),
    /WeChat Developer Tools/i,
  );
});

test('CLI builds exact bounded Compose commands', async () => {
  const { composeDownArgs, composeUpArgs } = await import('./start.mjs');
  const paths = createExpectedPaths();
  assert.deepEqual(composeUpArgs(paths.composePath), [
    'compose',
    '-p',
    'community-selection-l58-demo',
    '-f',
    paths.composePath,
    'up',
    '-d',
    '--build',
    '--wait',
    'postgres',
    'api',
  ]);
  assert.deepEqual(composeDownArgs(paths.composePath), [
    'compose',
    '-p',
    'community-selection-l58-demo',
    '-f',
    paths.composePath,
    'down',
    '--volumes',
    '--remove-orphans',
  ]);
});

test('CLI creates only the two reusable dependency cache volumes', async () => {
  const { ensureDemoCacheVolumes } = await import('./start.mjs');
  const calls = [];
  const names = ensureDemoCacheVolumes({
    runCommand: (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: `${args.at(-1)}\n`, stderr: '' };
    },
  });

  assert.deepEqual(names, [
    'community-selection-l58-api-node-modules-cache',
    'community-selection-l58-pnpm-store-cache',
  ]);
  assert.deepEqual(calls, [
    [
      'docker',
      ['volume', 'create', 'community-selection-l58-api-node-modules-cache'],
    ],
    [
      'docker',
      ['volume', 'create', 'community-selection-l58-pnpm-store-cache'],
    ],
  ]);
});

function createExpectedPaths() {
  const runtimeRoot = path.join(repoRoot, '.tmp', 'remote-demo');
  return {
    runtimeRoot,
    composePath: path.join(runtimeRoot, 'compose.json'),
    statePath: path.join(runtimeRoot, 'state.json'),
  };
}

test('CLI exposes a Quick Tunnel only after URL, registration, and public DNS', async () => {
  const { waitForQuickTunnel } = await import('./start.mjs');
  const child = new EventEmitter();
  child.pid = 345;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let releaseDns;
  const dnsReady = new Promise((resolve) => {
    releaseDns = resolve;
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
  void pending.then(() => {
    settled = true;
  });

  child.stderr.write('INF https://demo-child.trycloud');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(dnsHosts, []);

  child.stderr.write('flare.com\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(dnsHosts, []);

  child.stderr.write('INF Registered tunnel con');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(dnsHosts, []);

  child.stderr.write('nection connIndex=0\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(dnsHosts, ['demo-child.trycloudflare.com']);

  releaseDns(['104.16.230.132']);
  assert.deepEqual(await pending, {
    pid: 345,
    url: 'https://demo-child.trycloudflare.com',
  });
});

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

test('CLI rejects cloudflared exit before a tunnel URL is issued', async () => {
  const { waitForQuickTunnel } = await import('./start.mjs');
  const child = new EventEmitter();
  child.pid = 346;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  const pending = waitForQuickTunnel(child, { timeoutMs: 1_000 });
  child.emit('exit', 1, null);
  await assert.rejects(pending, /cloudflared exited.*1/i);
});

test('CLI verifies health and mock runtime before allowing a demo endpoint', async () => {
  const { probeDemoApi } = await import('./start.mjs');
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('/api/health')) {
      return new Response(
        JSON.stringify({ success: true, data: { status: 'ok' }, message: '' }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: { payment_mode: 'mock', version: 'l51' },
        message: '',
      }),
      { status: 200 },
    );
  };

  await assert.doesNotReject(
    probeDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl,
      timeoutMs: 1_000,
    }),
  );
  assert.deepEqual(calls, [
    'https://demo-child.trycloudflare.com/api/health',
    'https://demo-child.trycloudflare.com/api/public/runtime',
  ]);

  await assert.rejects(
    probeDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl: async (url) =>
        url.endsWith('/api/health')
          ? fetchImpl(url)
          : new Response(
              JSON.stringify({
                success: true,
                data: { payment_mode: 'wechat' },
                message: '',
              }),
              { status: 200 },
            ),
      timeoutMs: 1_000,
    }),
    /payment_mode.*mock/i,
  );
});

test('CLI waits for a transient public tunnel failure and succeeds once the route is ready', async () => {
  const { waitForDemoApi } = await import('./start.mjs');
  let healthAttempts = 0;
  let nowMs = 0;
  const sleepCalls = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/health')) {
      healthAttempts += 1;
      if (healthAttempts < 3) {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'ECONNRESET' };
        throw error;
      }
      return new Response(
        JSON.stringify({ success: true, data: { status: 'ok' }, message: '' }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        data: { payment_mode: 'mock', version: 'l51' },
        message: '',
      }),
      { status: 200 },
    );
  };

  await assert.doesNotReject(
    waitForDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl,
      requestTimeoutMs: 1_000,
      readinessTimeoutMs: 5_000,
      retryIntervalMs: 100,
      stage: 'public',
      now: () => nowMs,
      sleep: async (delayMs) => {
        sleepCalls.push(delayMs);
        nowMs += delayMs;
      },
    }),
  );
  assert.equal(healthAttempts, 3);
  assert.deepEqual(sleepCalls, [100, 100]);
});

test('CLI reports the failed API stage, path, and safe network code', async () => {
  const { probeDemoApi } = await import('./start.mjs');
  const fetchImpl = async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ECONNREFUSED' };
    throw error;
  };

  await assert.rejects(
    probeDemoApi('http://127.0.0.1:13180', {
      fetchImpl,
      timeoutMs: 1_000,
      stage: 'local',
    }),
    /Local Demo API request to \/api\/health failed \(ECONNREFUSED\)/,
  );
});

test('CLI never retries a non-mock payment mode', async () => {
  const { waitForDemoApi } = await import('./start.mjs');
  let runtimeRequests = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/health')) {
      return new Response(
        JSON.stringify({ success: true, data: { status: 'ok' }, message: '' }),
        { status: 200 },
      );
    }
    runtimeRequests += 1;
    return new Response(
      JSON.stringify({
        success: true,
        data: { payment_mode: 'wechat' },
        message: '',
      }),
      { status: 200 },
    );
  };

  await assert.rejects(
    waitForDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl,
      requestTimeoutMs: 1_000,
      readinessTimeoutMs: 5_000,
      retryIntervalMs: 100,
      stage: 'public',
      sleep: async () => {
        throw new Error('payment mode failures must not sleep or retry');
      },
    }),
    /payment_mode.*mock/i,
  );
  assert.equal(runtimeRequests, 1);
});

test('CLI never starts another request at or after the readiness deadline', async () => {
  const { waitForDemoApi } = await import('./start.mjs');
  let nowMs = 0;
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    nowMs += 60;
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ECONNRESET' };
    throw error;
  };

  await assert.rejects(
    waitForDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl,
      requestTimeoutMs: 1_000,
      readinessTimeoutMs: 100,
      retryIntervalMs: 100,
      stage: 'public',
      now: () => nowMs,
      sleep: async (delayMs) => {
        nowMs += delayMs;
      },
    }),
    /Public Demo API request to \/api\/health failed \(ECONNRESET\)/,
  );
  assert.equal(requests, 1);
  assert.equal(nowMs, 100);
});

test('CLI does not request runtime after health consumes the readiness budget', async () => {
  const { waitForDemoApi } = await import('./start.mjs');
  let nowMs = 0;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    nowMs = 100;
    return new Response(
      JSON.stringify({ success: true, data: { status: 'ok' }, message: '' }),
      { status: 200 },
    );
  };

  await assert.rejects(
    waitForDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl,
      requestTimeoutMs: 1_000,
      readinessTimeoutMs: 100,
      retryIntervalMs: 10,
      stage: 'public',
      now: () => nowMs,
      sleep: async () => {},
    }),
    /Public Demo API readiness deadline expired/,
  );
  assert.deepEqual(calls, [
    'https://demo-child.trycloudflare.com/api/health',
  ]);
});

test('CLI retries HTTP 5xx but immediately rejects HTTP 4xx and invalid responses', async (t) => {
  const { waitForDemoApi } = await import('./start.mjs');

  await t.test('retries a temporary HTTP 502', async () => {
    let healthAttempts = 0;
    const fetchImpl = async (url) => {
      if (url.endsWith('/api/health')) {
        healthAttempts += 1;
        if (healthAttempts === 1) {
          return new Response('temporary edge failure', { status: 502 });
        }
        return new Response(
          JSON.stringify({ success: true, data: { status: 'ok' }, message: '' }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: { payment_mode: 'mock' },
          message: '',
        }),
        { status: 200 },
      );
    };

    await waitForDemoApi('https://demo-child.trycloudflare.com', {
      fetchImpl,
      stage: 'public',
      sleep: async () => {},
    });
    assert.equal(healthAttempts, 2);
  });

  for (const scenario of [
    {
      name: 'HTTP 401',
      response: () => new Response('unauthorized', { status: 401 }),
      expected: /Public Demo API request to \/api\/health returned HTTP 401/,
    },
    {
      name: 'invalid JSON',
      response: () => new Response('not-json', { status: 200 }),
      expected: /Public Demo API request to \/api\/health returned invalid JSON/,
    },
    {
      name: 'invalid health contract',
      response: () =>
        new Response(
          JSON.stringify({ success: true, data: { status: 'starting' } }),
          { status: 200 },
        ),
      expected: /Demo API health response is invalid/,
    },
  ]) {
    await t.test(`immediately rejects ${scenario.name}`, async () => {
      let requests = 0;
      await assert.rejects(
        waitForDemoApi('https://demo-child.trycloudflare.com', {
          fetchImpl: async () => {
            requests += 1;
            return scenario.response();
          },
          stage: 'public',
          sleep: async () => {
            throw new Error('non-retryable responses must not sleep');
          },
        }),
        scenario.expected,
      );
      assert.equal(requests, 1);
    });
  }
});

test('CLI persists runtime state as a private atomic file', async () => {
  const { readStateFile, writeStateFile } = await import('./start.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'l58-state-'));
  const statePath = path.join(directory, 'runtime', 'state.json');
  const state = { version: 1, public: 'safe' };

  writeStateFile(state, statePath);
  assert.deepEqual(readStateFile(statePath), state);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(statePath)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ['state.json']);
  assert.equal(readStateFile(path.join(directory, 'missing.json')), null);
});
