const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  artifactPaths,
  assertHomeApiReady,
  assertPagePath,
  assertSupportedPlatform,
  composeLogsArgs,
  composePsArgs,
  composeStopArgs,
  composeUpArgs,
  normalizePagePath,
  overrideMiniappApiBaseUrl,
  resolveMiniappApiBaseUrl,
  resolveContainerConfig,
  resolveE2eConfig,
  restoreMiniappApiBaseUrl,
} = require('./lib.cjs');

test('rejects platforms that cannot launch WeChat DevTools', () => {
  assert.throws(
    () => assertSupportedPlatform('linux'),
    /requires macOS and WeChat DevTools/,
  );
});

test('resolves stable Mac defaults from the repository root', () => {
  const repoRoot = '/Users/test/community-selection-miniapp';
  assert.deepEqual(resolveE2eConfig({ env: {}, platform: 'darwin', repoRoot }), {
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: path.join(repoRoot, 'apps/miniapp'),
    port: 9420,
  });
});

test('normalizes page paths but still rejects the wrong destination', () => {
  assert.equal(normalizePagePath('/pages/products/index'), 'pages/products/index');
  assert.doesNotThrow(() => assertPagePath('/pages/products/index', 'pages/products/index'));
  assert.throws(
    () => assertPagePath('pages/orders/index', 'pages/products/index'),
    /Expected page pages\/products\/index, received pages\/orders\/index/,
  );
});

test('creates filesystem-safe evidence names', () => {
  const files = artifactPaths('/tmp', new Date('2026-07-20T12:34:56.789Z'));
  assert.match(files.log, /^\/tmp\/chunhuaqiushi-miniapp-e2e-2026-07-20T12-34-56-789Z\.log$/);
  assert.match(files.screenshot, /\.png$/);
  assert.match(files.composeLog, /-compose\.log$/);
  assert.doesNotMatch(files.log, /[: ]/);
});

test('targets only the PostgreSQL and API compose services by default', () => {
  const repoRoot = '/Users/test/community-selection-miniapp';
  assert.deepEqual(resolveContainerConfig({ env: {}, repoRoot }), {
    repoRoot,
    composeFile: path.join(repoRoot, 'docker-compose.yml'),
    healthUrl: 'http://127.0.0.1:13080/api/health',
    healthTimeoutMs: 30000,
    waitTimeoutSeconds: 300,
    services: ['postgres', 'api'],
  });
});

test('builds deterministic compose lifecycle commands', () => {
  const config = resolveContainerConfig({
    env: {
      MINIAPP_E2E_COMPOSE_WAIT_SECONDS: '420',
    },
    repoRoot: '/repo',
  });
  const prefix = [
    'compose',
    '--file', '/repo/docker-compose.yml',
    '--project-directory', '/repo',
  ];

  assert.deepEqual(composeUpArgs(config), [
    ...prefix,
    'up', '-d', '--wait', '--wait-timeout', '420', 'postgres', 'api',
  ]);
  assert.deepEqual(composePsArgs(config), [...prefix, 'ps', '--all', 'postgres', 'api']);
  assert.deepEqual(composeLogsArgs(config), [
    ...prefix,
    'logs', '--no-color', '--tail', '200', 'postgres', 'api',
  ]);
  assert.deepEqual(composeStopArgs(config), [...prefix, 'stop', 'postgres', 'api']);
});

test('rejects invalid container wait settings before invoking Docker', () => {
  assert.throws(
    () => resolveContainerConfig({
      env: { MINIAPP_E2E_COMPOSE_WAIT_SECONDS: 'zero' },
      repoRoot: '/repo',
    }),
    /Invalid MINIAPP_E2E_COMPOSE_WAIT_SECONDS/,
  );
  assert.throws(
    () => resolveContainerConfig({
      env: { MINIAPP_E2E_HEALTH_TIMEOUT_MS: '-1' },
      repoRoot: '/repo',
    }),
    /Invalid MINIAPP_E2E_HEALTH_TIMEOUT_MS/,
  );
});

test('normalizes the API origin used inside WeChat DevTools', () => {
  assert.equal(resolveMiniappApiBaseUrl({}), 'http://127.0.0.1:13080');
  assert.equal(
    resolveMiniappApiBaseUrl({ MINIAPP_E2E_API_BASE_URL: 'http://localhost:13080/' }),
    'http://localhost:13080',
  );
  assert.throws(
    () => resolveMiniappApiBaseUrl({ MINIAPP_E2E_API_BASE_URL: 'ftp://localhost:13080' }),
    /Invalid MINIAPP_E2E_API_BASE_URL/,
  );
});

test('requires both home API requests to finish without page-level errors', () => {
  assert.equal(assertHomeApiReady({ productsLoading: true, groupBuysLoading: false }), false);
  assert.equal(assertHomeApiReady({
    productsLoading: false,
    groupBuysLoading: false,
    productsError: '',
    groupBuysError: '',
  }), true);
  assert.throws(
    () => assertHomeApiReady({
      productsLoading: false,
      groupBuysLoading: false,
      productsError: 'network unavailable',
      groupBuysError: '',
    }),
    /Home API request failed: products: network unavailable/,
  );
});

test('temporarily overrides and then restores the Mini Program API base URL', async () => {
  const calls = [];
  const miniProgram = {
    async callWxMethod(...args) {
      calls.push(args);
      if (args[0] === 'getStorageSync') return 'https://previous.example';
      return undefined;
    },
  };

  const previous = await overrideMiniappApiBaseUrl(miniProgram, 'http://127.0.0.1:13080');
  await restoreMiniappApiBaseUrl(miniProgram, previous);

  assert.deepEqual(calls, [
    ['getStorageSync', 'API_BASE_URL'],
    ['setStorageSync', 'API_BASE_URL', 'http://127.0.0.1:13080'],
    ['setStorageSync', 'API_BASE_URL', 'https://previous.example'],
  ]);
});

test('removes the temporary API override when no previous value existed', async () => {
  const calls = [];
  const miniProgram = {
    async callWxMethod(...args) {
      calls.push(args);
      return '';
    },
  };

  const previous = await overrideMiniappApiBaseUrl(miniProgram, 'http://127.0.0.1:13080');
  await restoreMiniappApiBaseUrl(miniProgram, previous);

  assert.deepEqual(calls.at(-1), ['removeStorageSync', 'API_BASE_URL']);
});
