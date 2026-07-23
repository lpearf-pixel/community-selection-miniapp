import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminRefreshTarget } from './refresh-policy';

describe('admin refresh policy', () => {
  it.each([
    ['finance', 'finance'],
    ['operations', 'operations'],
    ['products', 'legacy'],
    ['inventory', 'legacy'],
  ] as const)('routes %s refresh to %s', (view, target) => {
    expect(adminRefreshTarget(view)).toBe(target);
  });

  it('keeps extracted endpoints and rendering outside AdminApp', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('/api/admin/finance/reconciliation/');
    expect(source).not.toContain('/api/admin/operations/dashboard/');
    expect(source).toContain('FinanceReconciliationPage');
    expect(source).toContain('OperationsDashboardPage');
  });
});
