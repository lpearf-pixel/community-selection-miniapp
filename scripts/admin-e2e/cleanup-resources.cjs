const { spawnSync } = require('node:child_process');

const rawSuffix = String(process.argv[2] ?? process.env.GITHUB_RUN_ID ?? '');
if (!/^[a-zA-Z0-9_-]+$/.test(rawSuffix)) {
  console.error('A safe Admin E2E run suffix is required');
  process.exit(2);
}

const project = `community-selection-admin-e2e-${rawSuffix}`;
const browserContainer = `community-selection-admin-e2e-browser-${rawSuffix}`;
const env = { ...process.env };

const browserRemoval = spawnSync('docker', ['rm', '-f', browserContainer], {
  encoding: 'utf8',
  env,
});
let browserCleanupFailed = false;

if (browserRemoval.error) {
  console.error(browserRemoval.error);
  browserCleanupFailed = true;
} else if (browserRemoval.status !== 0) {
  const browserInspection = spawnSync(
    'docker',
    ['container', 'inspect', browserContainer],
    {
      encoding: 'utf8',
      env,
    },
  );
  const inspectionError = [
    browserInspection.stderr,
    browserInspection.stdout,
  ].filter(Boolean).join('\n');

  if (
    browserInspection.error
    || browserInspection.status === 0
    || !/No such (?:container|object)/i.test(inspectionError)
  ) {
    if (browserRemoval.stderr) process.stderr.write(browserRemoval.stderr);
    if (browserInspection.error) console.error(browserInspection.error);
    else if (inspectionError) process.stderr.write(inspectionError);
    browserCleanupFailed = true;
  }
}

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
if (browserCleanupFailed) {
  process.exit(1);
}
