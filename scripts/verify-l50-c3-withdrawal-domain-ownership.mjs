import { spawnSync } from 'node:child_process';

const commands = [
  [
    'corepack',
    [
      'pnpm',
      '--filter',
      '@community-selection/api',
      'test',
      '--',
      'leader-withdrawal-command.test.ts',
      'admin-withdrawal-tax-review-command.test.ts',
      'withdrawal-owner.test.ts',
      'withdrawal-commission-owner.test.ts',
      'withdrawal-reward-ledger-owner.test.ts',
      'withdrawal-tax-owner.test.ts',
      'leader-withdrawal-executor.test.ts',
      'admin-withdrawal-tax-review-executor.test.ts',
      'withdrawal-domain-ownership.contract.test.ts',
      'withdrawal-domain-ownership.integration.test.ts',
    ],
  ],
  ['corepack', ['pnpm', '--filter', '@community-selection/api', 'typecheck']],
  ['corepack', ['pnpm', '--filter', '@community-selection/admin', 'typecheck']],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
    env: {
      ...process.env,
      COREPACK_HOME: process.env.COREPACK_HOME ?? '/tmp/corepack-home',
    },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('l50_c3_withdrawal_domain_ownership=true');
