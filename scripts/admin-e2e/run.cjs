const { existsSync } = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { dependencies: adminE2eDependencies } = require('./package.json');

const projectSuffix = String(process.env.GITHUB_RUN_ID ?? process.pid).replace(/[^a-zA-Z0-9_-]/g, '-');
const compose = ['compose', '-p', `community-selection-admin-e2e-${projectSuffix}`, '-f', 'docker-compose.yml'];
const databaseHost = process.env.ADMIN_E2E_DB_HOST
  ?? (existsSync('/.dockerenv') ? 'host.docker.internal' : '127.0.0.1');
const env = {
  ...process.env,
  DATABASE_URL: process.env.ADMIN_E2E_DATABASE_URL
    ?? `postgresql://postgres:postgres@${databaseHost}:15432/community_selection?schema=public`,
  ADMIN_AUTH_ENABLED: 'true',
  ADMIN_AUTH_MODE: 'session',
  ADMIN_TOKEN: 'l50-e2e-admin-token',
  ADMIN_TOTP_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
  PORT: '13080',
  VITE_API_BASE_URL: '',
};

const services = [];
const browserContainer = `community-selection-admin-e2e-browser-${projectSuffix}`;
let fixtureSetupAttempted = false;
let databaseStartAttempted = false;
let browserContainerCreateAttempted = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

function startService(label, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
    detached: process.platform !== 'win32',
  });
  child.on('error', (error) => {
    console.error(`${label} failed to start`, error);
  });
  services.push({ label, child });
  return child;
}

function stopService({ label, child }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`Failed to stop ${label}`, error);
  }
}

async function waitForUrl(label, url, child) {
  let lastError;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited with ${child.exitCode} before becoming ready`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${label} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} health check timed out: ${lastError?.message ?? 'unknown error'}`);
}

function runBrowserSmoke() {
  if (!existsSync('/.dockerenv')) {
    run('pnpm', ['--dir', 'scripts/admin-e2e', 'test']);
    return;
  }

  const runnerContainerId = process.env.HOSTNAME;
  if (!runnerContainerId) throw new Error('Container runner hostname is unavailable');
  const playwrightVersion = String(adminE2eDependencies.playwright ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(playwrightVersion)) {
    throw new Error(`Unsupported Playwright version: ${playwrightVersion || 'missing'}`);
  }
  const browserImage = process.env.ADMIN_E2E_PLAYWRIGHT_IMAGE
    ?? `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;

  browserContainerCreateAttempted = true;
  run('docker', [
    'create',
    '--init',
    '--name', browserContainer,
    '--network', `container:${runnerContainerId}`,
    '--ipc', 'host',
    '--workdir', '/work',
    browserImage,
    'sleep', 'infinity',
  ]);
  run('docker', ['start', browserContainer]);
  run('docker', ['exec', browserContainer, 'mkdir', '-p', '/work/node_modules']);
  run('docker', ['cp', 'scripts/admin-e2e/node_modules/.', `${browserContainer}:/work/node_modules`]);
  run('docker', ['cp', 'scripts/admin-e2e/admin-smoke.mjs', `${browserContainer}:/work/admin-smoke.mjs`]);
  run('docker', ['cp', 'scripts/admin-e2e/.fixture.json', `${browserContainer}:/work/.fixture.json`]);
  run('docker', [
    'exec',
    '-e', 'ADMIN_E2E_BASE_URL=http://127.0.0.1:13081',
    '-e', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    browserContainer,
    'node', '/work/admin-smoke.mjs',
  ]);
}

async function main() {
  try {
    databaseStartAttempted = true;
    run('docker', [...compose, 'up', '-d', '--wait', 'postgres']);
    run('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
    run('pnpm', ['--filter', '@community-selection/shared', 'build']);
    run('pnpm', ['--filter', '@community-selection/config', 'build']);
    fixtureSetupAttempted = true;
    run('pnpm', ['exec', 'tsx', 'scripts/admin-e2e/fixture.ts', 'setup']);

    const api = startService(
      'API',
      'pnpm',
      ['--filter', '@community-selection/api', 'exec', 'tsx', 'src/server.ts'],
    );
    const admin = startService(
      'Admin',
      'pnpm',
      ['--filter', '@community-selection/admin', 'exec', 'vite', '--host', '0.0.0.0', '--port', '13081'],
    );

    await Promise.all([
      waitForUrl('API', 'http://127.0.0.1:13080/api/health', api),
      waitForUrl('Admin', 'http://127.0.0.1:13081', admin),
    ]);
    runBrowserSmoke();
  } finally {
    if (fixtureSetupAttempted) {
      spawnSync('pnpm', ['exec', 'tsx', 'scripts/admin-e2e/fixture.ts', 'cleanup'], {
        stdio: 'inherit',
        env,
      });
    }
    if (browserContainerCreateAttempted) {
      spawnSync('docker', ['rm', '-f', browserContainer], { stdio: 'inherit', env });
    }
    for (const service of services.reverse()) stopService(service);
    if (databaseStartAttempted) {
      spawnSync('docker', [...compose, 'down', '--volumes', '--remove-orphans'], {
        stdio: 'inherit',
        env,
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
