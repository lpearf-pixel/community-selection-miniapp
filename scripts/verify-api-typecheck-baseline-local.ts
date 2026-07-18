import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(command: string, args: string[], cwd = process.cwd()): void {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

const tsconfig = JSON.parse(readFileSync('tsconfig.base.json', 'utf8')) as {
  compilerOptions?: { paths?: Record<string, string[]> };
};
const paths = tsconfig.compilerOptions?.paths ?? {};

for (const workspacePackage of [
  '@community-selection/shared',
  '@community-selection/config',
]) {
  assert(
    !Object.hasOwn(paths, workspacePackage),
    `${workspacePackage} must resolve through workspace package exports, not tsconfig paths`,
  );
}

const withdrawals = readFileSync('apps/api/src/routes/withdrawals.ts', 'utf8');
assert(
  /export function taxExportLimit\(configuredLimit\?: number\): number/.test(withdrawals),
  'taxExportLimit must declare a definite number return type',
);
assert(
  withdrawals.includes('snapshot: Prisma.InputJsonValue | null'),
  'tax review history snapshots must be Prisma JSON input values',
);
assert(
  withdrawals.includes('const recordPayload: Prisma.InputJsonObject'),
  'tax record payload must satisfy Prisma JSON input typing',
);

run('pnpm', ['--filter', '@community-selection/shared', 'build']);
run('pnpm', ['--filter', '@community-selection/config', 'build']);

const runtimeSmoke = [
  "import { ok, fail } from '@community-selection/shared';",
  "import { config } from '@community-selection/config';",
  "if (typeof ok !== 'function' || typeof fail !== 'function') throw new Error('shared runtime exports missing');",
  "if (!config || typeof config !== 'object') throw new Error('config runtime export missing');",
  "console.log('workspace_runtime_resolution=passed');",
].join('\n');
run('node', ['--input-type=module', '--eval', runtimeSmoke], 'apps/api');

run('pnpm', ['--filter', '@community-selection/api', 'typecheck']);

console.log('API typecheck baseline verification passed.');
