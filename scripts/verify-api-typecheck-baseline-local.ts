import { readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tsconfig = JSON.parse(readFileSync('tsconfig.base.json', 'utf8')) as {
  compilerOptions?: { paths?: Record<string, string[]> };
};
const paths = tsconfig.compilerOptions?.paths ?? {};

assert(
  paths['@community-selection/shared']?.[0] === 'packages/shared/dist/index.d.ts',
  'shared path alias must resolve to its declaration entry',
);
assert(
  paths['@community-selection/config']?.[0] === 'packages/config/dist/index.d.ts',
  'config path alias must resolve to its declaration entry',
);

const withdrawals = readFileSync('apps/api/src/routes/withdrawals.ts', 'utf8');
assert(
  /export function taxExportLimit\(configuredLimit\?: number\): number/.test(withdrawals),
  'taxExportLimit must declare a definite number return type',
);
assert(
  withdrawals.includes('snapshot: Prisma.InputJsonValue | null'),
  'tax review history snapshots must be Prisma JSON input values',
);

console.log('API typecheck baseline verification passed.');
