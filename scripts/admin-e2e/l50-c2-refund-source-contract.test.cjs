const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const root = join(__dirname, '..', '..');
const afterSales = readFileSync(
  join(root, 'apps/api/src/routes/after-sales.ts'),
  'utf8',
);
const refunds = readFileSync(
  join(root, 'apps/api/src/routes/refunds.ts'),
  'utf8',
);
const fixture = readFileSync(
  join(root, 'scripts/admin-e2e/fixture.ts'),
  'utf8',
);
const smoke = readFileSync(
  join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
  'utf8',
);
const adminE2eRunner = readFileSync(
  join(root, 'scripts/admin-e2e/run.cjs'),
  'utf8',
);
const l15Verifier = readFileSync(
  join(root, 'scripts/verify-l15-after-sale-local.ts'),
  'utf8',
);
const legacyRefundVerifiers = [
  'verify-l16-finance-reconciliation-local.ts',
  'verify-l17-operations-dashboard-local.ts',
  'verify-l17-5-normal-purchase-local.ts',
  'verify-docker-api-e2e-local.ts',
].map((name) => readFileSync(join(root, 'scripts', name), 'utf8'));
const adminTypes = readFileSync(
  join(root, 'apps/admin/src/features/sales/after-sales/types.ts'),
  'utf8',
);

test('refund execution has one protected Admin write boundary', () => {
  assert.match(
    afterSales,
    /\/api\/admin\/after-sales\/:id\/refund-execute/,
  );
  assert.match(afterSales, /requireAdminPermissionV1\(\s*\[/);
  assert.match(afterSales, /'after_sale\.manage'/);
  assert.match(afterSales, /'refund\.manage'/);
  assert.match(afterSales, /parseAdminRefundCommand\(request\.body\)/);
  assert.match(afterSales, /executeAdminRefundCommand\(/);
});

test('Admin after-sale list exposes reliable refund execution inputs', () => {
  assert.match(afterSales, /resolution_type:\s*item\.resolution_type/);
  assert.match(afterSales, /version:\s*order\.version/);
  assert.match(
    adminTypes,
    /export type AfterSaleRefundExecutionResult = \{[\s\S]*?version: number;/,
  );
  assert.doesNotMatch(adminTypes, /order_version:/);
});

test('public refund mutations are retired while notify fails closed', () => {
  assert.doesNotMatch(refunds, /app\.post\('\/api\/refunds\/mock'/);
  assert.doesNotMatch(refunds, /app\.post\('\/api\/refunds\/wechat\/apply'/);
  assert.match(refunds, /app\.post\('\/api\/refunds\/wechat\/notify'/);
  assert.match(refunds, /reply\.code\(501\)/);
});

test('real Admin browser proves same-version refund execution is atomic', () => {
  assert.match(fixture, /const refundOrderNo = /);
  assert.match(fixture, /const refundOrder = await prisma\.order\.create\(/);
  assert.match(fixture, /const refundCase = await prisma\.afterSaleCase\.create\(/);
  assert.match(fixture, /resolution_type:\s*'partial_refund'/);
  assert.match(fixture, /refundOrderId:\s*refundOrder\.id/);
  assert.match(fixture, /refundCaseId:\s*refundCase\.id/);

  assert.match(smoke, /const refundConflictPage = await context\.newPage\(\)/);
  assert.match(
    smoke,
    /\/api\/admin\/after-sales\/\$\{credentials\.refundCaseId\}\/refund-execute/,
  );
  assert.match(smoke, /assert\.deepEqual\(refundRaceCodes,\s*\[200,\s*409\]\)/);
  assert.match(smoke, /refundSuccessEnvelope\.data\.version,\s*2/);
  assert.match(smoke, /assert\.equal\(refundOrderEnvelope\.data\.items\[0\]\.version,\s*2\)/);
  assert.match(smoke, /assert\.equal\(refundLedgerEnvelope\.data\.total,\s*1\)/);
});

test('real Admin browser runs the reliable refund command in explicit MOCK mode', () => {
  assert.match(
    adminE2eRunner,
    /MOCK_WECHAT_PAY:\s*'true'/,
    'the host-started API must opt into the only implemented refund provider',
  );
});

test('real Admin browser restores orders before injecting the order refresh failure', () => {
  const refundRaceFinished = smoke.indexOf(
    'await refundConflictPage.close();',
  );
  const orderFailureRoute = smoke.indexOf(
    'const orderFailureRoute = async (route) => {',
    refundRaceFinished,
  );
  const restoreOrders = smoke.indexOf(
    'await ordersButton.click();',
    refundRaceFinished,
  );

  assert.ok(refundRaceFinished >= 0);
  assert.ok(orderFailureRoute > refundRaceFinished);
  assert.ok(
    restoreOrders > refundRaceFinished && restoreOrders < orderFailureRoute,
    'the primary Admin page must restore Order Management before refreshing the injected order failure',
  );
});

test('real Admin browser counts only mutations that succeeded on the primary page', () => {
  assert.match(
    smoke,
    /let pickupSuccessOwnerPage;[\s\S]*?pickupSuccessOwnerPage = successfulEntries\[0\]\.ownerPage;/,
  );
  assert.match(
    smoke,
    /let refundSuccessOwnerPage;[\s\S]*?refundSuccessOwnerPage = successfulEntries\[0\]\.ownerPage;/,
  );
  assert.match(
    smoke,
    /const primaryBusinessRefreshes = \[\s*pickupSuccessOwnerPage,\s*refundSuccessOwnerPage,\s*\]\.filter\(\(ownerPage\) => ownerPage === page\)\.length;/,
  );
  assert.match(
    smoke,
    /await waitForCount\(\s*page,\s*\(\) => inventoryOverviewRequestCount,\s*a33RequestsAfterInitial\.inventory \+ primaryBusinessRefreshes,/,
  );
});

test('L15 verification executes approved refunds through the reliable command', () => {
  assert.match(
    l15Verifier,
    /\/api\/admin\/after-sales\/\$\{afterSale\.id\}\/refund-execute/,
  );
  assert.doesNotMatch(
    l15Verifier,
    /\/api\/admin\/after-sales\/\$\{afterSale\.id\}\/resolve/,
  );
  assert.match(
    l15Verifier,
    /expected_version:\s*reviewed\.order\.version/,
  );
  assert.match(
    l15Verifier,
    /approved_product_refund_cents:\s*800/,
  );
  assert.doesNotMatch(
    l15Verifier,
    /expected_version:\s*reviewed\.version/,
  );
});

test('release verifiers do not execute refunds through the retired resolve route', () => {
  for (const verifier of legacyRefundVerifiers) {
    assert.doesNotMatch(
      verifier,
      /\/api\/admin\/after-sales\/\$\{[^}]+\}\/resolve/,
    );
    assert.match(
      verifier,
      /\/api\/admin\/after-sales\/\$\{[^}]+\}\/refund-execute/,
    );
  }
});
