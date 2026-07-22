import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveProjectE2eConfig } from '../src/config.js';

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: originalPlatform,
  });
});

describe('project E2E configuration', () => {
  it('resolves the repository and default Mini Program path from the suite root', () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

    const config = resolveProjectE2eConfig({
      WECHAT_CLI_PATH: path.join(repoRoot, 'package.json'),
    });

    expect(config.repoRoot).toBe(repoRoot);
    expect(config.projectPath).toBe(path.join(repoRoot, 'apps/miniapp'));
  });
});
