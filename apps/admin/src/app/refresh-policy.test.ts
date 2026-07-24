import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { adminRefreshTarget } from './refresh-policy';

function namedFunctionSource(source: string, name: string): string {
  const sourceFile = ts.createSourceFile(
    'AdminApp.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let match: ts.FunctionDeclaration | undefined;

  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  expect(match, `function ${name}`).toBeDefined();
  return match!.getText(sourceFile);
}

describe('admin refresh policy', () => {
  it.each([
    ['finance', 'finance'],
    ['operations', 'operations'],
    ['products', 'catalog'],
    ['groupBuys', 'group-buys'],
    ['failedGroupBuyClosure', 'group-buys'],
    ['orders', 'orders'],
    ['fulfillment', 'fulfillment'],
    ['afterSales', 'after-sales'],
    ['inventory', 'inventory'],
    ['purchasePlans', 'purchase-plans'],
    ['suppliers', 'suppliers'],
    ['batches', 'batches'],
    ['expiryAlerts', 'expiry-alerts'],
    ['stockChecks', 'stock-checks'],
    ['withdrawals', 'withdrawals'],
    ['alerts', 'alerts'],
    ['taxRecords', 'tax-review'],
  ] as const)('routes %s refresh to %s', (view, target) => {
    expect(adminRefreshTarget(view)).toBe(target);
  });

  it('keeps all extracted endpoints, DTOs, and rendering outside AdminApp', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );
    const endpoints = [
      '/api/admin/finance/reconciliation/',
      '/api/admin/operations/dashboard/',
      '"/api/categories"',
      '"/api/products"',
      '"/api/group-buys"',
      '"/api/orders"',
      '"/api/admin/fulfillment/overview"',
      '"/api/admin/after-sales"',
      '"/api/admin/inventory/overview"',
      '"/api/admin/purchase-plans"',
      '"/api/admin/suppliers"',
      '"/api/admin/inventory/batches"',
      '"/api/admin/inventory/expiry-alerts?days=7"',
      '"/api/admin/stock-checks"',
      '"/api/admin/withdrawals"',
      '"/api/admin/logs/alerts"',
      '"/api/admin/tax-records"',
    ];
    for (const endpoint of endpoints) {
      expect(source, endpoint).not.toContain(endpoint);
    }

    for (const typeName of [
      'Product',
      'Category',
      'GroupBuy',
      'Order',
      'FulfillmentOverview',
      'AfterSaleCase',
      'InventoryOverview',
      'PurchasePlan',
      'Supplier',
      'ProductBatch',
      'ExpiryAlert',
      'StockCheck',
      'Withdrawal',
      'OpsAlert',
      'TaxRecord',
    ]) {
      expect(source).not.toContain(`type ${typeName} =`);
    }

    for (const page of [
      'CatalogProductsPage',
      'FinanceReconciliationPage',
      'OperationsDashboardPage',
      'GroupBuyManagementPage',
      'OrdersPage',
      'FulfillmentOverviewPage',
      'AfterSalesPage',
      'InventoryOverviewPage',
      'PurchasePlansPage',
      'SuppliersPage',
      'InventoryBatchesPage',
      'ExpiryAlertsPage',
      'StockChecksPage',
      'WithdrawalsPage',
      'OperationsAlertsPage',
      'TaxReviewPage',
    ]) {
      expect(source).toContain(page);
    }
  });

  it('does not preload business data after session restore or login', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('refreshLegacyFeatures');
    expect(source).not.toMatch(
      /setAdminSession\(admin\);[\s\S]{0,160}setView\(DEFAULT_ADMIN_VIEW\);[\s\S]{0,160}\brefresh/,
    );
    expect(source).not.toMatch(
      /setAdminSession\(result\.admin_user\);[\s\S]{0,160}setView\(DEFAULT_ADMIN_VIEW\);[\s\S]{0,160}\brefresh/,
    );
  });

  it('keeps all extracted mutation handlers outside AdminApp', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );
    for (const handler of [
      'reviewWithdrawalTax',
      'updateWithdrawal',
      'updateAlert',
    ]) {
      expect(source).not.toContain(`function ${handler}`);
    }
    expect(source).not.toContain('refreshSalesAndLegacyFeatures');
  });

  it('routes Shell refresh without a legacy fallback', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );
    const loginSource = namedFunctionSource(source, 'loginAdmin');
    const shellRefreshSource = namedFunctionSource(
      source,
      'refreshActiveFeature',
    );

    expect(source).not.toContain('refreshLegacyFeatures');
    expect(loginSource).not.toMatch(/\brefresh\w*Features\(\);/);
    expect(loginSource).not.toMatch(/\brefreshBusinessFeatures\(\);/);
    expect(shellRefreshSource).not.toMatch(/\brefreshBusinessFeatures\(\);/);
    expect(shellRefreshSource).not.toContain('legacy');
    for (const setter of [
      'setWithdrawalsRefreshVersion',
      'setAlertsRefreshVersion',
      'setTaxReviewRefreshVersion',
    ]) {
      expect(shellRefreshSource).toContain(
        `${setter}((version) => version + 1);`,
      );
    }
  });

  it('composes all thirteen extracted mutation refreshes exactly once', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );
    const composedRefresh = namedFunctionSource(
      source,
      'refreshBusinessFeatures',
    );

    for (const setter of [
      'setGroupBuysRefreshVersion',
      'setOrdersRefreshVersion',
      'setFulfillmentRefreshVersion',
      'setAfterSalesRefreshVersion',
      'setInventoryRefreshVersion',
      'setPurchasePlansRefreshVersion',
      'setSuppliersRefreshVersion',
      'setBatchesRefreshVersion',
      'setExpiryAlertsRefreshVersion',
      'setStockChecksRefreshVersion',
      'setWithdrawalsRefreshVersion',
      'setAlertsRefreshVersion',
      'setTaxReviewRefreshVersion',
    ]) {
      expect(composedRefresh).toContain(
        `${setter}((version) => version + 1);`,
      );
      expect(
        composedRefresh.match(new RegExp(`\\b${setter}\\(`, 'g')),
      ).toHaveLength(1);
    }
    expect(composedRefresh).not.toContain('refreshLegacyFeatures');
  });

  it('isolates every hidden A3.2, A3.3, and A3.4 slice behind its own boundary', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );
    const boundarySource = readFileSync(
      new URL('./AdminErrorBoundary.tsx', import.meta.url),
      'utf8',
    );
    const slices = [
      ['fulfillment', 'fulfillmentRefreshVersion', 'FulfillmentOverviewPage'],
      ['inventory', 'inventoryRefreshVersion', 'InventoryOverviewPage'],
      ['purchasePlans', 'purchasePlansRefreshVersion', 'PurchasePlansPage'],
      ['orders', 'ordersRefreshVersion', 'OrdersPage'],
      ['suppliers', 'suppliersRefreshVersion', 'SuppliersPage'],
      ['batches', 'batchesRefreshVersion', 'InventoryBatchesPage'],
      ['expiryAlerts', 'expiryAlertsRefreshVersion', 'ExpiryAlertsPage'],
      ['stockChecks', 'stockChecksRefreshVersion', 'StockChecksPage'],
      ['afterSales', 'afterSalesRefreshVersion', 'AfterSalesPage'],
      ['withdrawals', 'withdrawalsRefreshVersion', 'WithdrawalsPage'],
      ['alerts', 'alertsRefreshVersion', 'OperationsAlertsPage'],
      ['taxRecords', 'taxReviewRefreshVersion', 'TaxReviewPage'],
    ] as const;

    expect(source).toMatch(
      /<div\s+hidden=\{\s*view !== "groupBuys"\s*&&\s*view !== "failedGroupBuyClosure"\s*\}\s*>[\s\S]*?<AdminErrorBoundary resetKey=\{String\(groupBuysRefreshVersion\)\}>[\s\S]*?<GroupBuyManagementPage\b[\s\S]*?<\/AdminErrorBoundary>[\s\S]*?<\/div>/,
    );
    for (const [view, version, page] of slices) {
      expect(source, view).toMatch(
        new RegExp(
          `<div hidden=\\{view !== "${view}"\\}>\\s*<AdminErrorBoundary resetKey=\\{String\\(${version}\\)\\}>[\\s\\S]*?<${page}\\b[\\s\\S]*?<\\/AdminErrorBoundary>\\s*<\\/div>`,
        ),
      );
    }

    expect(source.match(/<AdminErrorBoundary\b/g)).toHaveLength(14);
    expect(source).toMatch(
      /<AdminErrorBoundary resetKey=\{view\}>\s*<AdminFeatureWorkspace render=\{renderFeatureContent\} \/>\s*<\/AdminErrorBoundary>/,
    );
    expect(boundarySource).toMatch(
      /previous\.resetKey !== this\.props\.resetKey && this\.state\.error[\s\S]*?this\.setState\(\{ error: null \}\)/,
    );
  });

  it('bridges only the compact product and batch defaults', () => {
    const source = readFileSync(
      new URL('./AdminApp.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('InventoryProductReference');
    expect(source).toMatch(
      /useState<InventoryProductReference \| null>\(null\)/,
    );
    expect(source).toMatch(/useState\(""\)/);
    expect(source).toContain(
      'onDefaultProductReference={setDefaultInventoryProductReference}',
    );
    expect(source).toContain('onDefaultBatchId={setDefaultBatchId}');
    expect(source).toContain(
      'defaultProductReference={defaultInventoryProductReference}',
    );
    expect(source).toContain('defaultBatchId={defaultBatchId}');
    expect(source).toMatch(
      /defaultProductId=\{\s*defaultInventoryProductReference\?\.product_id \?\? ""\s*\}/,
    );
    expect(source).toMatch(
      /defaultLossProductId=\{\s*defaultInventoryProductReference\?\.product_id \?\? ""\s*\}/,
    );
  });
});
