const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  artifactPaths,
  assertHomeApiReady,
  assertPagePath,
  assertSupportedPlatform,
  buildDevToolsAutoArgs,
  composeLogsArgs,
  composePsArgs,
  composeStopArgs,
  composeUpArgs,
  diagnoseDevToolsLaunch,
  normalizePagePath,
  overrideMiniappApiBaseUrl,
  resolveMiniappApiBaseUrl,
  resolveContainerConfig,
  resolveE2eConfig,
  restoreMiniappApiBaseUrl,
} = require('./lib.cjs');

function loadDevToolsLauncher() {
  let launcher;
  assert.doesNotThrow(() => {
    launcher = require('./devtools-launcher.cjs');
  }, 'the DevTools launcher module must exist');
  assert.equal(typeof launcher.launchDevTools, 'function');
  return launcher;
}

function fakeCliProcess(stdout = '', stderr = '') {
  const stream = (value) => ({
    on(event, handler) {
      if (event === 'data' && value) handler(Buffer.from(value));
    },
  });
  return {
    stdout: stream(stdout),
    stderr: stream(stderr),
    on() {},
  };
}

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
    launchTimeoutMs: 60000,
  });
});

test('builds the explicit WeChat DevTools automation command', () => {
  assert.deepEqual(buildDevToolsAutoArgs({
    projectPath: '/repo/apps/miniapp',
    port: 9527,
  }), [
    'auto',
    '--project', '/repo/apps/miniapp',
    '--auto-port', '9527',
    '--trust-project',
  ]);
});

test('turns hidden CLI output into actionable automation diagnostics', () => {
  assert.match(
    diagnoseDevToolsLaunch('Error: 服务端口未开启'),
    /服务端口/,
  );
  assert.match(
    diagnoseDevToolsLaunch('当前为游客模式，请先登录'),
    /登录微信开发者工具/,
  );
  assert.match(
    diagnoseDevToolsLaunch(''),
    /127\.0\.0\.1.*自动化端口/,
  );
});

test('reuses an existing compatible automation endpoint without spawning the CLI', async () => {
  const { launchDevTools } = loadDevToolsLauncher();
  const miniProgram = { id: 'existing' };
  let spawned = false;
  const result = await launchDevTools({
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: '/repo/apps/miniapp',
    port: 9420,
    launchTimeoutMs: 60000,
  }, {
    isPortOpen: async () => true,
    connect: async () => miniProgram,
    spawnProcess: () => {
      spawned = true;
      return fakeCliProcess();
    },
  });

  assert.equal(result.miniProgram, miniProgram);
  assert.equal(result.reused, true);
  assert.equal(spawned, false);
});

test('starts the CLI and waits for the automation port before connecting', async () => {
  const { launchDevTools } = loadDevToolsLauncher();
  const miniProgram = { id: 'launched' };
  let checks = 0;
  let command;
  const result = await launchDevTools({
    cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: '/repo/apps/miniapp',
    port: 9527,
    launchTimeoutMs: 60000,
  }, {
    isPortOpen: async () => {
      checks += 1;
      return checks >= 3;
    },
    connect: async (endpoint) => {
      assert.equal(endpoint, 'ws://127.0.0.1:9527');
      return miniProgram;
    },
    spawnProcess: (cliPath, args) => {
      command = [cliPath, ...args];
      return fakeCliProcess('automation starting');
    },
    delay: async () => {},
    now: (() => {
      let value = 0;
      return () => {
        value += 100;
        return value;
      };
    })(),
  });

  assert.deepEqual(command, [
    '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    'auto', '--project', '/repo/apps/miniapp', '--auto-port', '9527', '--trust-project',
  ]);
  assert.equal(result.miniProgram, miniProgram);
  assert.equal(result.reused, false);
  assert.match(result.cliOutput, /automation starting/);
});

test('preserves CLI output and explains a service-port timeout', async () => {
  const { launchDevTools } = loadDevToolsLauncher();
  await assert.rejects(
    launchDevTools({
      cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      projectPath: '/repo/apps/miniapp',
      port: 9420,
      launchTimeoutMs: 100,
    }, {
      isPortOpen: async () => false,
      spawnProcess: () => fakeCliProcess('', '服务端口未开启'),
      delay: async () => {},
      now: (() => {
        let value = 0;
        return () => {
          value += 100;
          return value;
        };
      })(),
    }),
    (error) => {
      assert.match(error.message, /服务端口/);
      assert.match(error.devToolsOutput, /服务端口未开启/);
      return true;
    },
  );
});

test('click smoke uses the diagnostic launcher and persists DevTools evidence', () => {
  const source = fs.readFileSync(path.join(__dirname, 'home-smoke.cjs'), 'utf8');
  assert.match(source, /require\('\.\/devtools-launcher\.cjs'\)/);
  assert.match(source, /launchDevTools\(config\)/);
  assert.match(source, /artifacts\.devToolsLog/);
  assert.doesNotMatch(source, /automator\.launch/);
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
  assert.match(files.devToolsLog, /-devtools\.log$/);
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
