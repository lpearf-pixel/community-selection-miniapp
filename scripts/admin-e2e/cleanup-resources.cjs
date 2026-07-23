const { spawnSync } = require('node:child_process');

const rawSuffix = String(process.argv[2] ?? process.env.GITHUB_RUN_ID ?? '');
if (!/^[a-zA-Z0-9_-]+$/.test(rawSuffix)) {
  console.error('A safe Admin E2E run suffix is required');
  process.exit(2);
}

const project = `community-selection-admin-e2e-${rawSuffix}`;
const browserContainer = `community-selection-admin-e2e-browser-${rawSuffix}`;
const env = { ...process.env };

spawnSync('docker', ['rm', '-f', browserContainer], {
  stdio: 'inherit',
  env,
});

const composeDown = spawnSync(
  'docker',
  [
    'compose',
    '-p',
    project,
    '-f',
    'docker-compose.yml',
    'down',
    '--volumes',
    '--remove-orphans',
  ],
  {
    stdio: 'inherit',
    env,
  },
);

if (composeDown.error) {
  console.error(composeDown.error);
  process.exit(1);
}
if (composeDown.status !== 0) {
  process.exit(composeDown.status ?? 1);
}
