const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('requires the additive order version and Admin command receipt', () => {
  const schema = read('prisma/schema.prisma');
  assert.match(schema, /\bversion\s+Int\s+@default\(1\)/);
  assert.match(schema, /\bmodel AdminCommandReceipt\s*\{/);
  assert.match(
    schema,
    /@@unique\(\[admin_user_id,\s*idempotency_key\]\)/,
  );
});

test('retires unauthenticated order read and write handlers', () => {
  const routes = read('apps/api/src/routes/group-buys.ts');
  assert.match(routes, /app\.post\('\/api\/orders'/);
  assert.match(routes, /app\.post\('\/api\/orders\/normal'/);
  assert.doesNotMatch(routes, /app\.get\('\/api\/orders'/);
  assert.doesNotMatch(
    routes,
    /app\.post\('\/api\/orders\/:id\/(?:status|complete)'/,
  );
});

test('requires the protected V1 Admin status command boundary', () => {
  const routes = read('apps/api/src/routes/admin/orders.ts');
  assert.match(routes, /'\/api\/admin\/orders\/:id\/status'/);
  assert.match(routes, /requireAdminPermissionV1\('order\.manage'\)/);
  assert.match(routes, /expected_version/);
  assert.match(routes, /idempotency_key/);
  assert.match(routes, /ADMIN_ORDER_VERSION_CONFLICT/);
});

test('requires current data scope for export and legacy pickup verification', () => {
  const groupBuyRoutes = read('apps/api/src/routes/group-buys.ts');
  const fulfillmentRoutes = read('apps/api/src/routes/fulfillment.ts');
  assert.match(
    groupBuyRoutes,
    /\/api\/admin\/orders\/export\/picking\.csv[\s\S]{0,200}requireAdminPermission\('order\.view'\)/,
  );
  assert.match(groupBuyRoutes, /getScopedOrderWhere/);
  assert.match(
    fulfillmentRoutes,
    /\/api\/admin\/orders\/:id\/pickup-verify[\s\S]{0,200}requireAdminPermission\('pickup\.verify'\)/,
  );
  assert.match(fulfillmentRoutes, /canAccessOrderDataScope/);
});

test('exposes order version to the Admin client and list projection', () => {
  const types = read('apps/admin/src/features/sales/orders/types.ts');
  const query = read('apps/api/src/routes/admin/order-list-query.ts');
  assert.match(types, /AdminOrderListItem\s*=\s*\{[\s\S]*?\bversion:\s*number/);
  assert.match(query, /version:\s*order\.version/);
});


test('requires strict atomic effects and complete runtime evidence', () => {
  const executor = read(
    'apps/api/src/modules/order/admin-order-status-executor.ts',
  );
  const commission = read('apps/api/src/services/commission-service.ts');
  const route = read('apps/api/src/routes/admin/orders.ts');
  const runtime = read(
    'apps/api/src/routes/admin/order-status-route.integration.test.ts',
  );
  const transaction = read(
    'apps/api/src/modules/order/admin-order-status-executor.integration.test.ts',
  );
  const smoke = read('scripts/admin-e2e/admin-smoke.mjs');

  assert.doesNotMatch(executor, /safeRecord(?:BusinessEvent|OrderTimeline)/);
  assert.match(executor, /await recordBusinessEvent\(tx,/);
  assert.match(executor, /await recordOrderTimeline\(tx,/);
  assert.match(
    commission,
    /markCommissionPendingForCompletedOrder[\s\S]*?await recordBusinessEvent\(client,[\s\S]*?await recordOrderTimeline\(client,/,
  );
  assert.match(route, /errorHandler:\s*adminOrderStatusV1ErrorHandler/);
  assert.match(runtime, /malformed JSON/);
  assert.match(runtime, /retired public routes/);
  assert.match(runtime, /\/api\/me\/orders/);
  assert.match(transaction, /real completion commission once/);
  assert.match(transaction, /strict reward event logging fails/);
  assert.match(smoke, /externalAdvance\.status\(\), 200/);
  assert.match(smoke, /conflictResponse\.status\(\), 409/);
  assert.match(smoke, /ADMIN_ORDER_VERSION_CONFLICT/);
});
