import { spawnSync } from 'node:child_process';

const steps = [
  {
    name: 'L50-C3 focused domain ownership tests',
    args: [
      '--filter',
      '@community-selection/api',
      'test',
      '--',
      'src/modules/payment/payment-record-service.test.ts',
      'src/modules/order/order-payment-service.test.ts',
      'src/modules/group-buy/group-buy-payment-service.test.ts',
      'src/modules/inventory/inventory-order-service.test.ts',
      'src/services/payment-domain-ownership.contract.test.ts',
      'src/services/payment-domain-ownership.integration.test.ts',
    ],
  },
  {
    name: 'L50-C3 API typecheck',
    args: ['--filter', '@community-selection/api', 'typecheck'],
  },
];

for (const step of steps) {
  console.log(`\n[verify:l50-c3] ${step.name}`);
  const result = spawnSync('pnpm', step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('\nL50-C3 payment domain ownership verification passed.');
