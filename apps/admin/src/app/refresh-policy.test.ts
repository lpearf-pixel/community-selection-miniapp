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
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  expect(match, `function ${name}`).toBeDefined();
  return match!.getText(sourceFile);
}

function sourceSection(
  source: string,
  start: string,
  end: string,
  label: string,
): string {
  const startIndex = source.indexOf(start);
  expect(startIndex, `${label}: start`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex, `${label}: end`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
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
    expect(source).not.toContain('"/api/group-buys"');
    expect(source).not.toContain('"/api/orders"');
    expect(source).not.toContain('"/api/admin/fulfillment/overview"');
    expect(source).not.toContain('"/api/admin/after-sales"');
    expect(source).not.toContain('type GroupBuy =');
    expect(source).not.toContain('type Order =');
    expect(source).not.toContain('type FulfillmentOverview =');
    expect(source).not.toContain('type AfterSaleCase =');
    expect(source).toContain('CatalogProductsPage');
    expect(source).toContain('hidden={view !== "products"}');
    expect(source).toContain('FinanceReconciliationPage');
    expect(source).toContain('OperationsDashboardPage');
    expect(source).toContain('GroupBuyManagementPage');
    expect(source).toContain('OrdersPage');
    expect(source).toContain('FulfillmentOverviewPage');
    expect(source).toContain('AfterSalesPage');
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

  it('refreshes extracted sales slices after every remaining successful mutation', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    const mutationHandlers = [
      'reviewWithdrawalTax',
      'updateWithdrawal',
      'updateAlert',
      'adjustInventory',
      'createPurchasePlan',
      'confirmPurchasePlan',
      'cancelPurchasePlan',
      'receivePurchasePlan',
      'createSupplier',
      'disableSupplier',
      'recordBatchLoss',
      'createStockCheck',
      'confirmStockCheck',
    ];

    for (const handler of mutationHandlers) {
      const handlerSource = namedFunctionSource(source, handler);
      expect(handlerSource, handler).toMatch(
        /\brefreshSalesAndLegacyFeatures\(\);/,
      );
      expect(handlerSource, handler).not.toMatch(
        /\brefreshLegacyFeatures\(\);/,
      );
    }
  });

  it('keeps authentication and the Shell legacy fallback on legacy-only refresh', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    const loginSource = namedFunctionSource(source, 'loginAdmin');
    const shellRefreshSource = namedFunctionSource(source, 'refreshActiveFeature');

    expect(source).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?setAdminSession\(admin\);[\s\S]*?setView\(DEFAULT_ADMIN_VIEW\);[\s\S]*?refreshLegacyFeatures\(\);[\s\S]*?\}, \[\]\);/,
    );
    expect(loginSource).toMatch(/\brefreshLegacyFeatures\(\);/);
    expect(loginSource).not.toMatch(/\brefreshSalesAndLegacyFeatures\(\);/);
    expect(shellRefreshSource).toMatch(/\brefreshLegacyFeatures\(\);/);
    expect(shellRefreshSource).not.toMatch(
      /\brefreshSalesAndLegacyFeatures\(\);/,
    );
  });

  it('composes all four extracted refreshes with the remaining legacy refresh', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    const composedRefresh = namedFunctionSource(
      source,
      'refreshSalesAndLegacyFeatures',
    );

    for (const setter of [
      'setGroupBuysRefreshVersion',
      'setOrdersRefreshVersion',
      'setFulfillmentRefreshVersion',
      'setAfterSalesRefreshVersion',
    ]) {
      expect(composedRefresh).toContain(`${setter}((version) => version + 1);`);
    }
    expect(composedRefresh).toMatch(/\brefreshLegacyFeatures\(\);/);
  });

  it('isolates every hidden A3.2 slice behind its own resettable boundary', () => {
    const source = readFileSync(new URL('./AdminApp.tsx', import.meta.url), 'utf8');
    const boundarySource = readFileSync(
      new URL('./AdminErrorBoundary.tsx', import.meta.url),
      'utf8',
    );
    const groupBuys = sourceSection(
      source,
      '<div\n          hidden={\n            view !== "groupBuys" && view !== "failedGroupBuyClosure"\n          }\n        >',
      '<div hidden={view !== "fulfillment"}>',
      'group-buy hidden slice',
    );
    const fulfillment = sourceSection(
      source,
      '<div hidden={view !== "fulfillment"}>',
      '{view === "inventory"',
      'fulfillment hidden slice',
    );
    const orders = sourceSection(
      source,
      '<div hidden={view !== "orders"}>',
      '{view === "suppliers"',
      'orders hidden slice',
    );
    const afterSales = sourceSection(
      source,
      '<div hidden={view !== "afterSales"}>',
      '{view === "withdrawals"',
      'after-sales hidden slice',
    );

    const slices = [
      [groupBuys, 'groupBuysRefreshVersion', 'GroupBuyManagementPage'],
      [fulfillment, 'fulfillmentRefreshVersion', 'FulfillmentOverviewPage'],
      [orders, 'ordersRefreshVersion', 'OrdersPage'],
      [afterSales, 'afterSalesRefreshVersion', 'AfterSalesPage'],
    ] as const;
    for (const [section, refreshVersion, page] of slices) {
      expect(section).toMatch(
        new RegExp(
          `<AdminErrorBoundary resetKey=\\{String\\(${refreshVersion}\\)\\}>[\\s\\S]*?<${page}\\b[\\s\\S]*?<\\/AdminErrorBoundary>`,
        ),
      );
      expect(section.match(/<AdminErrorBoundary\b/g)).toHaveLength(1);
      expect(section.match(/<\/AdminErrorBoundary>/g)).toHaveLength(1);
    }

    expect(source.match(/<AdminErrorBoundary\b/g)).toHaveLength(5);
    expect(source).toMatch(
      /<AdminErrorBoundary resetKey=\{view\}>\s*<AdminFeatureWorkspace render=\{renderFeatureContent\} \/>\s*<\/AdminErrorBoundary>/,
    );
    expect(boundarySource).toMatch(
      /previous\.resetKey !== this\.props\.resetKey && this\.state\.error[\s\S]*?this\.setState\(\{ error: null \}\)/,
    );
  });
});
