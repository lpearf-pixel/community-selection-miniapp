const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const read = (path) => readFileSync(path, 'utf8');

test('L50-C2-T3-C has one reliable manual inventory adjustment path', () => {
  const route = read('apps/api/src/routes/inventory.ts');
  const legacyService = read(
    'apps/api/src/modules/inventory/inventory-service.ts',
  );
  const executor = read(
    'apps/api/src/modules/inventory/admin-inventory-adjust-executor.ts',
  );
  const adminApi = read(
    'apps/admin/src/features/inventory/overview/api.ts',
  );
  const adminPage = read(
    'apps/admin/src/features/inventory/overview/InventoryOverviewPage.tsx',
  );

  assert.match(
    route,
    /requireAdminPermissionV1\('product\.manage'\)/,
  );
  assert.match(route, /parseAdminInventoryAdjustCommand/);
  assert.match(route, /executeAdminInventoryAdjustCommand/);
  assert.match(route, /contractOk/);
  assert.match(route, /contractFail/);
  assert.doesNotMatch(route, /\badjustStockByAdmin\b/);
  assert.doesNotMatch(legacyService, /\badjustStockByAdmin\b/);

  assert.match(executor, /product\.updateMany/);
  assert.match(executor, /stock:\s*input\.command\.expected_stock/);
  assert.match(executor, /stock:\s*\{\s*increment:/);
  assert.match(executor, /event_type:\s*'inventory_manual_adjusted'/);
  assert.match(executor, /response_code:\s*SUCCESS_CODE/);
  assert.doesNotMatch(executor, /\b(order|refund|withdrawal)\.(findMany|count)/);

  assert.match(adminApi, /expected_stock:\s*expectedStock/);
  assert.match(adminApi, /idempotency_key:\s*createIdempotencyKey\(\)/);
  assert.match(adminApi, /crypto\.randomUUID\(\)/);
  assert.match(adminPage, /adjustingProductIdsRef\.current\.has/);
  assert.match(adminPage, /disabled=\{adjustingProductIds\.has/);
  assert.match(adminPage, /loading=\{adjustingProductIds\.has/);
  assert.match(adminPage, /commitInventoryAdjustment/);
});
