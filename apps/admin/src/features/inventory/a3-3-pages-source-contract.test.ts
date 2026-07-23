import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('A3.3 inventory and supply page boundaries', () => {
  const pages = [
    ['overview/InventoryOverviewPage.tsx', '库存管理加载失败'],
    ['../supply/purchase-plans/PurchasePlansPage.tsx', '采购计划加载失败'],
    ['../supply/suppliers/SuppliersPage.tsx', '供应商管理加载失败'],
    ['batches/InventoryBatchesPage.tsx', '批次库存加载失败'],
    ['expiry-alerts/ExpiryAlertsPage.tsx', '临期提醒加载失败'],
    ['stock-checks/StockChecksPage.tsx', '库存盘点加载失败'],
  ] as const;

  it.each(pages)(
    'gives %s a generation-safe loader and local retry',
    (path, errorMessage) => {
      const source = read(path);

      expect(source).toContain('useFeatureResourceLoader');
      expect(source).toContain('refreshVersion');
      expect(source).toContain(`message="${errorMessage}"`);
      expect(source).toMatch(/onClick=\{retry\}[\s\S]*?>\s*重试\s*</);
      expect(source).not.toContain('refreshLegacyFeatures');
      expect(source).not.toContain('refreshBusinessFeatures');
    },
  );

  it('keeps compact default references outside the composition root lists', () => {
    const inventory = read('overview/InventoryOverviewPage.tsx');
    const purchasePlans = read(
      '../supply/purchase-plans/PurchasePlansPage.tsx',
    );
    const batches = read('batches/InventoryBatchesPage.tsx');
    const stockChecks = read('stock-checks/StockChecksPage.tsx');

    expect(inventory).toContain('onDefaultProductReference');
    expect(inventory).toContain('toInventoryProductReference');
    expect(purchasePlans).toContain('defaultProductReference');
    expect(batches).toContain('onDefaultBatchId');
    expect(stockChecks).toContain('defaultBatchId');
    expect(stockChecks).toContain('defaultProductId');
  });

  it('protects product and batch ledger selection from stale responses', () => {
    const inventory = read('overview/InventoryOverviewPage.tsx');
    const batches = read('batches/InventoryBatchesPage.tsx');

    for (const source of [inventory, batches]) {
      expect(source).toContain('ledgerRequestGenerationRef');
      expect(source).toContain('activeLedgerRequestRef');
      expect(source).toContain('new AbortController()');
      expect(source).toContain('activeLedgerRequestRef.current?.abort()');
      expect(source).toContain(
        'ledgerRequestGenerationRef.current === generation',
      );
      expect(source).toContain('settleLatestFeatureRequest');
      expect(source).toMatch(
        /useEffect\(\s*\(\) => \(\) => \{[\s\S]*?ledgerRequestGenerationRef\.current \+= 1;[\s\S]*?activeLedgerRequestRef\.current\?\.abort\(\);/,
      );
    }
  });

  it('keeps mutation callbacks out of the read-only expiry page', () => {
    const expiryAlerts = read('expiry-alerts/ExpiryAlertsPage.tsx');

    expect(expiryAlerts).not.toContain('onMutationCommitted');
    expect(expiryAlerts).not.toContain('onMessage');
  });
});
