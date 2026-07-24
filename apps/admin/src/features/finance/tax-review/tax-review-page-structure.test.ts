import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = (name: string) =>
  fileURLToPath(new URL(name, import.meta.url));
const source = (name: string) => readFileSync(sourcePath(name), 'utf8');

describe('tax review page source boundaries', () => {
  it('keeps the orchestrator at or below 200 lines', () => {
    const page = source('./TaxReviewPage.tsx');

    expect(page.split('\n').length).toBeLessThanOrEqual(201);
  });

  it('delegates the filters, table, and drawer views', () => {
    const page = source('./TaxReviewPage.tsx');

    for (const component of [
      'TaxReviewFilters',
      'TaxReviewTable',
      'TaxReviewDrawer',
    ]) {
      expect(page).toContain(`<${component}`);
      expect(existsSync(sourcePath(`./${component}.tsx`))).toBe(true);
    }
    expect(page).not.toMatch(/<Table\b/);
    expect(page).not.toMatch(/<Drawer\b/);
    expect(page).not.toMatch(/<DatePicker\.RangePicker\b/);
  });
});
