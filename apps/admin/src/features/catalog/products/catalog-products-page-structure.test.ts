import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = (name: string) =>
  fileURLToPath(new URL(name, import.meta.url));
const source = (name: string) => readFileSync(sourcePath(name), 'utf8');

describe('catalog products page source boundaries', () => {
  it('keeps the orchestrator at or below 200 lines', () => {
    expect(
      source('./CatalogProductsPage.tsx').trimEnd().split('\n').length,
    ).toBeLessThanOrEqual(200);
  });

  it('delegates the table and form views', () => {
    const page = source('./CatalogProductsPage.tsx');
    for (const component of ['CatalogProductsTable', 'CatalogProductForm']) {
      expect(page).toContain(`<${component}`);
      expect(existsSync(sourcePath(`./${component}.tsx`))).toBe(true);
      expect(source(`./${component}.tsx`)).toContain(
        `export function ${component}`,
      );
    }
    expect(page).not.toMatch(/<Table\b/);
    expect(page).not.toMatch(/<Form\b/);
    expect(page).not.toMatch(/<(Input|InputNumber|Select|Switch)\b/);
    expect(page).not.toContain('columns={[');
  });
});
