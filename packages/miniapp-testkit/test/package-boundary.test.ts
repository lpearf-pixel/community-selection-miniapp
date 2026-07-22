import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.name.endsWith('.ts') ? [absolute] : [];
  });
}

describe('extractable package boundary', () => {
  it('contains no Community Selection routes, selectors, or domain fields', () => {
    const source = sourceFiles(path.join(packageRoot, 'src'))
      .map((file) => fs.readFileSync(file, 'utf8'))
      .join('\n');
    for (const forbidden of [
      'community-selection',
      '/api/products',
      'product-normal-buy',
      'group-buy',
      'pickup_store',
      'order_status',
    ]) {
      expect(source, `generic package must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('declares its own build, test, typecheck, exports, and Node runtime', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(manifest.name).toBe('@community-selection/miniapp-testkit');
    expect(manifest.type).toBe('module');
    expect(manifest.engines.node).toContain('>=22.12.0');
    expect(manifest.scripts).toMatchObject({
      build: expect.any(String),
      test: expect.any(String),
      typecheck: expect.any(String),
    });
    expect(manifest.exports['.']).toBeTruthy();
  });
});
