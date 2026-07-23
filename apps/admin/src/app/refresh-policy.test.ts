import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminRefreshTarget } from './refresh-policy';

describe('admin refresh policy', () => {
  it.each([
    ['finance', 'finance'],
    ['operations', 'operations'],
    ['products', 'catalog'],
    ['inventory', 'legacy'],
  ] as const)('routes %s refresh to %s', (view, target) => {
    expect(adminRefreshTarget(view)).toBe(target);
  });

  it('keeps extracted endpoints and rendering outside AdminApp', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('/api/admin/finance/reconciliation/');
    expect(source).not.toContain('/api/admin/operations/dashboard/');
    expect(source).not.toContain('"/api/categories"');
    expect(source).not.toContain('"/api/products"');
    expect(source).not.toContain('type Product =');
    expect(source).not.toContain('type Category =');
    expect(source).toContain('CatalogProductsPage');
    expect(source).toContain('FinanceReconciliationPage');
    expect(source).toContain('OperationsDashboardPage');
  });

  it('keeps preloading the remaining legacy views after session restore and login', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(
      /setAdminSession\(admin\);[\s\S]{0,160}setView\(DEFAULT_ADMIN_VIEW\);[\s\S]{0,160}refreshLegacyFeatures\(\);/,
    );
    expect(source).toMatch(
      /setAdminSession\(result\.admin_user\);[\s\S]{0,160}setView\(DEFAULT_ADMIN_VIEW\);[\s\S]{0,160}refreshLegacyFeatures\(\);/,
    );
  });
});
