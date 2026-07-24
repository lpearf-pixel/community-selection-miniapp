import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const featureRoot = path.resolve(
  process.cwd(),
  'apps/admin/src/features/finance/tax-review',
);

describe('tax review page source boundaries', () => {
  it('keeps the orchestrator at or below 200 lines', () => {
    const page = fs.readFileSync(
      path.join(featureRoot, 'TaxReviewPage.tsx'),
      'utf8',
    );

    expect(page.split('\n').length).toBeLessThanOrEqual(201);
  });

  it('delegates the filters, table, and drawer views', () => {
    const page = fs.readFileSync(
      path.join(featureRoot, 'TaxReviewPage.tsx'),
      'utf8',
    );

    for (const component of [
      'TaxReviewFilters',
      'TaxReviewTable',
      'TaxReviewDrawer',
    ]) {
      expect(page).toContain(`<${component}`);
      expect(
        fs.existsSync(path.join(featureRoot, `${component}.tsx`)),
      ).toBe(true);
    }
    expect(page).not.toMatch(/<Table\b/);
    expect(page).not.toMatch(/<Drawer\b/);
    expect(page).not.toMatch(/<DatePicker\.RangePicker\b/);
  });
});
