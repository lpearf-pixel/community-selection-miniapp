const { spawnSync } = require('node:child_process');

const compose = ['compose', '-f', 'docker-compose.yml', '-f', 'scripts/admin-e2e/docker-compose.e2e.yml'];
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:15432/community_selection?schema=public',
  ADMIN_AUTH_ENABLED: 'true',
  ADMIN_AUTH_MODE: 'session',
  ADMIN_TOKEN: 'l50-e2e-admin-token',
  ADMIN_TOTP_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
}

function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('curl', ['-fsS', 'http://127.0.0.1:13080/api/health'], { stdio: 'ignore', env });
    if (result.status === 0) return;
    spawnSync('sleep', ['2']);
  }
  throw new Error('API health check timed out');
}

let fixtureCreated = false;
try {
  run('docker', [...compose, 'up', '-d', '--build', 'postgres', 'api', 'admin']);
  waitForHealth();
  run('pnpm', ['exec', 'tsx', 'scripts/admin-e2e/fixture.ts', 'setup']);
  fixtureCreated = true;
  run('pnpm', ['--dir', 'scripts/admin-e2e', 'test']);
} finally {
  if (fixtureCreated) {
    spawnSync('pnpm', ['exec', 'tsx', 'scripts/admin-e2e/fixture.ts', 'cleanup'], { stdio: 'inherit', env });
  }
  spawnSync('docker', [...compose, 'down'], { stdio: 'inherit', env });
}
