import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDemoConfig } from './config.mjs';
import { renderDemoCompose, writeDemoCompose } from './compose.mjs';
import {
  createRuntimePaths,
  DEMO_PROJECT_NAME,
  startRemoteDemo,
} from './lifecycle.mjs';
import { generateMiniappCopy } from './miniapp-copy.mjs';
import { extractQuickTunnelUrls } from './tunnel.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '../..');
const WECHAT_DEVTOOLS_APPS = [
  '/Applications/wechatwebdevtools.app',
  '/Applications/微信开发者工具.app',
];

function supportedNodeVersion(version) {
  const [major, minor] = String(version)
    .split('.')
    .map((part) => Number(part));
  return (
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 12) ||
    major > 22
  );
}

function defaultRunCommand(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function assertDemoPrerequisites({
  platform = process.platform,
  nodeVersion = process.versions.node,
  runCommand = defaultRunCommand,
  exists = fs.existsSync,
} = {}) {
  if (platform !== 'darwin') {
    throw new Error('L58 remote demo must run on macOS');
  }
  if (!supportedNodeVersion(nodeVersion)) {
    throw new Error('Node 20.19+ or 22.12+ is required');
  }
  for (const [command, args, label] of [
    ['pnpm', ['--version'], 'pnpm'],
    ['docker', ['compose', 'version'], 'Docker Compose'],
    ['cloudflared', ['--version'], 'cloudflared'],
  ]) {
    const result = runCommand(command, args);
    if (result.error || result.status !== 0) {
      throw new Error(`${label} is required for the L58 remote demo`);
    }
  }
  if (!WECHAT_DEVTOOLS_APPS.some((candidate) => exists(candidate))) {
    throw new Error('WeChat Developer Tools is required in /Applications');
  }
}

export function composeUpArgs(composePath) {
  return [
    'compose',
    '-p',
    DEMO_PROJECT_NAME,
    '-f',
    composePath,
    'up',
    '-d',
    '--build',
    '--wait',
    'postgres',
    'api',
  ];
}

export function composeDownArgs(composePath) {
  return [
    'compose',
    '-p',
    DEMO_PROJECT_NAME,
    '-f',
    composePath,
    'down',
    '--volumes',
    '--remove-orphans',
  ];
}

export function waitForQuickTunnel(child, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const urls = new Set();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeListener('data', onData);
      child.stderr?.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      try {
        for (const url of extractQuickTunnelUrls(chunk.toString('utf8'))) {
          urls.add(url);
        }
        if (urls.size > 1) {
          finish(new Error('cloudflared emitted multiple Quick Tunnel URLs'));
        } else if (urls.size === 1) {
          finish(null, { pid: child.pid, url: [...urls][0] });
        }
      } catch (error) {
        finish(error);
      }
    };
    const onError = (error) => finish(error);
    const onExit = (code, signal) =>
      finish(
        new Error(
          `cloudflared exited before issuing a tunnel URL (code ${code}, signal ${signal ?? 'none'})`,
        ),
      );
    const timer = setTimeout(
      () => finish(new Error('Timed out waiting for a Quick Tunnel URL')),
      timeoutMs,
    );
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function readJsonResponse(fetchImpl, url, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
  } catch {
    throw new Error('Demo API request failed');
  }
  if (!response.ok) throw new Error(`Demo API returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error('Demo API returned invalid JSON');
  }
}

export async function probeDemoApi(
  origin,
  { fetchImpl = fetch, timeoutMs = 5_000 } = {},
) {
  const parsed = new URL(origin);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Demo API origin is invalid');
  }
  const normalized = parsed.origin;
  const health = await readJsonResponse(
    fetchImpl,
    `${normalized}/api/health`,
    timeoutMs,
  );
  if (
    health?.success !== true ||
    health?.data?.status !== 'ok'
  ) {
    throw new Error('Demo API health response is invalid');
  }
  const runtime = await readJsonResponse(
    fetchImpl,
    `${normalized}/api/public/runtime`,
    timeoutMs,
  );
  if (
    runtime?.success !== true ||
    runtime?.data?.payment_mode !== 'mock'
  ) {
    throw new Error('Demo API payment_mode must remain mock');
  }
}

export function writeStateFile(state, statePath) {
  const directory = path.dirname(statePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(statePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(state, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    fs.renameSync(temporaryPath, statePath);
    fs.chmodSync(statePath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (!cleanupError || cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}

export function readStateFile(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function runChecked(command, args, { cwd, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw new Error(`Unable to run ${command}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
}

function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => reject(new Error(`Demo port ${port} is already in use`)));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function readProcessCommand(pid) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return null;
  const command = result.stdout.trim();
  return command || null;
}

function waitUntilStopped(statePath, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!fs.existsSync(statePath)) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for the L58 demo to stop'));
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

export function createConcreteDeps({ config, paths, shutdown }) {
  return {
    orchestratorPid: process.pid,
    now: () => new Date(),
    readState: (statePath) => readStateFile(statePath),
    writeState: (state, statePath) => writeStateFile(state, statePath),
    readProcessCommand,
    killProcess: (pid, signal) => process.kill(pid, signal),
    waitUntilStopped,
    assertActive: () => shutdown?.assertActive(),
    assertPrerequisites: () => assertDemoPrerequisites(),
    assertPortsAvailable: async () => {
      await portAvailable(config.apiPort);
      await portAvailable(config.adminPort);
    },
    prepareCompose: () => {
      if (fs.existsSync(paths.miniappOutputDir)) {
        throw new Error('Stale L58 Mini Program output exists; run demo:remote:stop');
      }
      writeDemoCompose(
        renderDemoCompose(config, { repoRoot: paths.repoRoot }),
        paths.composePath,
      );
    },
    composeUp: () =>
      runChecked('docker', composeUpArgs(paths.composePath), {
        cwd: paths.repoRoot,
      }),
    composeDown: () =>
      runChecked('docker', composeDownArgs(paths.composePath), {
        cwd: paths.repoRoot,
      }),
    probeLocalApi: (origin) => probeDemoApi(origin, { timeoutMs: 10_000 }),
    startTunnel: async (localOrigin) => {
      const child = spawn(
        'cloudflared',
        ['tunnel', '--no-autoupdate', '--url', localOrigin],
        {
          cwd: paths.repoRoot,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      try {
        const ready = await waitForQuickTunnel(child);
        child.stdout?.resume();
        child.stderr?.resume();
        return ready;
      } catch (error) {
        if (child.pid && readProcessCommand(child.pid)) {
          process.kill(child.pid, 'SIGTERM');
        }
        throw error;
      }
    },
    probePublicApi: (origin) => probeDemoApi(origin, { timeoutMs: 15_000 }),
    generateCopy: ({ tunnelUrl }) =>
      generateMiniappCopy({
        sourceDir: path.join(paths.repoRoot, 'apps/miniapp'),
        outputDir: paths.miniappOutputDir,
        apiBaseUrl: tunnelUrl,
        appId: config.appId,
        forbiddenValues: [
          config.appSecret,
          config.sessionTokenSecret,
          config.adminToken,
        ],
      }),
    printSummary: (state) => {
      process.stdout.write(
        [
          '',
          'L58 远端微信演示已启动。',
          `临时 API：${state.tunnelUrl}`,
          `小程序目录：${state.miniappOutputDir}`,
          `自动停止：${state.deadlineAt}`,
          `本机后台：http://127.0.0.1:${config.adminPort}`,
          '下一步：打开上述小程序目录，上传新的体验版并发送新二维码。',
          '演示结束：pnpm demo:remote:stop',
          '',
        ].join('\n'),
      );
    },
    waitForShutdown: (deadlineAt) => shutdown.waitForShutdown(deadlineAt),
    removeRuntime: () => {
      fs.rmSync(paths.runtimeRoot, { recursive: true, force: true });
    },
  };
}

function createShutdownController() {
  let pendingReason = null;
  let resolveWait = null;
  let timer = null;
  const signalHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      pendingReason = signal;
      if (resolveWait) resolveWait(signal);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }
  return {
    assertActive() {
      if (pendingReason) throw new Error(`startup interrupted by ${pendingReason}`);
    },
    waitForShutdown(deadlineAt) {
      if (pendingReason) return Promise.resolve(pendingReason);
      return new Promise((resolve) => {
        resolveWait = (reason) => {
          if (timer) clearTimeout(timer);
          resolve(reason);
        };
        const delay = Math.max(0, deadlineAt.getTime() - Date.now());
        timer = setTimeout(() => resolveWait('ttl'), delay);
      });
    },
    close() {
      if (timer) clearTimeout(timer);
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    },
  };
}

export async function main(repoRoot = defaultRepoRoot) {
  const paths = createRuntimePaths(repoRoot);
  const config = loadDemoConfig({ repoRoot: paths.repoRoot });
  const shutdown = createShutdownController();
  try {
    const result = await startRemoteDemo({
      config,
      paths,
      deps: createConcreteDeps({ config, paths, shutdown }),
    });
    if (result.status === 'already_running') {
      process.stdout.write(
        `L58 remote demo is already running at ${result.state.tunnelUrl}\n`,
      );
    }
    return result;
  } finally {
    shutdown.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
