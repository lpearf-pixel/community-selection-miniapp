import { spawnSync } from 'node:child_process';

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

const withPostgres = process.argv.includes('--with-postgres');

run('node', [
  '--test',
  'scripts/inventory-e2e/l50-c2-inventory-adjust-source-contract.test.cjs',
]);
console.log('inventory_adjust_source_contract=true');

run('node_modules/.bin/vitest', [
  'run',
  'apps/api/src/modules/inventory/admin-inventory-adjust-command.test.ts',
  'apps/api/src/modules/inventory/admin-inventory-adjust-executor.test.ts',
  'apps/api/src/routes/admin-inventory-adjust-route.test.ts',
]);
console.log('inventory_adjust_api_unit=true');

run('node_modules/.bin/vitest', [
  'run',
  'apps/admin/src/features/inventory/overview/api.test.ts',
  'apps/admin/src/features/inventory/overview/inventory-adjust-mutation.test.ts',
]);
console.log('inventory_adjust_admin_interaction=true');

run('node_modules/.bin/tsc', ['-p', 'apps/api/tsconfig.json', '--noEmit']);
run('node_modules/.bin/tsc', ['-p', 'apps/admin/tsconfig.json', '--noEmit']);
console.log('inventory_adjust_types=true');

if (withPostgres) {
  run('node_modules/.bin/vitest', [
    'run',
    'apps/api/src/modules/inventory/admin-inventory-adjust-executor.integration.test.ts',
  ]);
  run('node_modules/.bin/vitest', [
    'run',
    'apps/api/src/routes/admin-inventory-adjust-route.integration.test.ts',
  ]);
  console.log('inventory_adjust_postgres_concurrency=true');
  console.log('inventory_adjust_idempotent_replay=true');
  console.log('inventory_adjust_o1_event=true');
  console.log('inventory_adjust_transaction_rollback=true');
}
