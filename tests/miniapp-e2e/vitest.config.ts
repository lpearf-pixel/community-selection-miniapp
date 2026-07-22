import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const real = process.env.MINIAPP_E2E_REAL === '1';

export default defineConfig({
  root,
  resolve: {
    alias: {
      '@community-selection/miniapp-testkit': path.resolve(
        root,
        '../../packages/miniapp-testkit/src/index.ts',
      ),
    },
  },
  test: {
    include: real ? ['test/business.e2e.test.ts'] : ['test/**/*.test.ts'],
    exclude: real ? [] : ['test/business.e2e.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    pool: 'forks',
    testTimeout: real ? 180_000 : 10_000,
    hookTimeout: real ? 120_000 : 10_000,
    sequence: { concurrent: false },
  },
});
