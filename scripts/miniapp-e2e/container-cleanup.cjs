const { spawnSync } = require('node:child_process');
const {
  composeDownArgs,
  resolveContainerConfig,
} = require('./lib.cjs');

const config = resolveContainerConfig();
const result = spawnSync('docker', composeDownArgs(config), {
  cwd: config.repoRoot,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (result.error) {
  process.stderr.write(`Unable to run Docker: ${result.error.message}\n`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.stderr.write(`Docker cleanup exited with status ${result.status}\n`);
  process.exitCode = result.status || 1;
} else {
  process.stdout.write('Mini Program E2E containers stopped; named volumes were preserved.\n');
}
