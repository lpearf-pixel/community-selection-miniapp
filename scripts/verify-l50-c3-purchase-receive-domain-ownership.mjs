import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'L50-C3 purchase receive owners and PostgreSQL tests',
    args: [
      '--filter',
      '@community-selection/api',
      'test',
      '--',
      'src/modules/purchase/admin-purchase-receive-command.test.ts',
      'src/modules/purchase/purchase-plan-owner.test.ts',
      'src/modules/inventory/purchase-inventory-owner.test.ts',
      'src/modules/inventory/purchase-batch-owner.test.ts',
      'src/modules/purchase/admin-purchase-receive-executor.test.ts',
      'src/modules/purchase/purchase-domain-ownership.contract.test.ts',
      'src/modules/purchase/purchase-domain-ownership.integration.test.ts',
    ],
  },
  {
    name: 'L50-C3 purchase receive Admin client',
    args: [
      '--filter',
      '@community-selection/admin',
      'test',
      '--',
      'src/features/supply/purchase-plans/api.test.ts',
    ],
  },
  {
    name: 'L50-C3 purchase receive API typecheck',
    args: ['--filter', '@community-selection/api', 'typecheck'],
  },
  {
    name: 'L50-C3 purchase receive Admin typecheck',
    args: ['--filter', '@community-selection/admin', 'typecheck'],
  },
];

for (const step of steps) {
  console.log(`\n[verify:l50-c3-purchase] ${step.name}`);
  const result = spawnSync('pnpm', step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(
  '\nL50-C3 purchase receive domain ownership verification passed.',
);
