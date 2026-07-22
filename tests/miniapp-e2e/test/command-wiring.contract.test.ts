import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('framework command wiring', () => {
  it('exposes one local framework gate and one real Mac business command', () => {
    const manifest = JSON.parse(read('package.json'));
    expect(manifest.scripts['test:miniapp:e2e-framework']).toContain(
      'tests/miniapp-e2e/vitest.config.ts',
    );
    expect(manifest.scripts['test:miniapp:e2e-framework']).toContain(
      'packages/miniapp-testkit',
    );
    expect(manifest.scripts['e2e:miniapp:business']).toBe(
      'node scripts/miniapp-e2e/container-runner.cjs --suite business',
    );
  });

  it('runs business through Vitest rather than the monolithic script', () => {
    const runner = read('scripts/miniapp-e2e/container-runner.cjs');
    expect(runner).toContain("MINIAPP_E2E_REAL: '1'");
    expect(runner).toContain("require.resolve('vitest/vitest.mjs')");
    expect(runner).toContain('tests/miniapp-e2e/vitest.config.ts');
    expect(runner).not.toMatch(/business:\s*['"]business-flow\.cjs['"]/);
  });

  it('registers both extractable packages in the workspace', () => {
    const workspace = read('pnpm-workspace.yaml');
    expect(workspace).toContain('- "packages/*"');
    expect(workspace).toContain('- "tests/*"');
  });
});
