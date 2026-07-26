import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'L50-C3 refund owner and PostgreSQL tests',
    args: [
      '--filter',
      '@community-selection/api',
      'test',
      '--',
      'src/modules/refund/refund-record-service.test.ts',
      'src/modules/order/order-refund-service.test.ts',
      'src/modules/after-sale/after-sale-refund-owner.test.ts',
      'src/modules/consumer-credit/order-refund-credit-service.test.ts',
      'src/modules/inventory/inventory-order-service.test.ts',
      'src/services/refund-domain-ownership.contract.test.ts',
      'src/services/refund-domain-ownership.integration.test.ts',
      'src/modules/refund/admin-refund-executor.integration.test.ts',
    ],
  },
  {
    name: 'L50-C3 refund API typecheck',
    args: ['--filter', '@community-selection/api', 'typecheck'],
  },
];

for (const step of steps) {
  console.log(`\n[verify:l50-c3-refund] ${step.name}`);
  const result = spawnSync('pnpm', step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nL50-C3 refund domain ownership verification passed.');
