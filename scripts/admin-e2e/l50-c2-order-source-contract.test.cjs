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

test('requires current data scope for Admin order export', () => {
  const groupBuyRoutes = read('apps/api/src/routes/group-buys.ts');
  assert.match(
    groupBuyRoutes,
    /\/api\/admin\/orders\/export\/picking\.csv[\s\S]{0,200}requireAdminPermission\('order\.view'\)/,
  );
  assert.match(groupBuyRoutes, /getScopedOrderWhere/);
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
  const auxiliaryRuntime = read(
    'apps/api/src/routes/admin/order-auxiliary-security.integration.test.ts',
  );

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
  assert.doesNotMatch(smoke, /externalAdvance/);
  assert.match(
    smoke,
    /await page\.route\('\*\*\/api\/admin\/orders\/\*\/status', statusRaceRoute\);/,
  );
  assert.match(smoke, /await route\.fetch\(\)/);
  assert.match(
    smoke,
    /sameVersionStatusButton\.dispatchEvent\('click'\)[\s\S]*?sameVersionStatusButton\.dispatchEvent\('click'\)/,
  );
  assert.match(smoke, /assert\.deepEqual\(statusRaceCodes, \[200, 409\]\);/);
  assert.match(smoke, /'order success refresh'/);
  assert.match(smoke, /'order conflict refresh'/);
  assert.match(smoke, /ADMIN_ORDER_VERSION_CONFLICT/);
  assert.match(auxiliaryRuntime, /returns 403 when export scope is empty/);
  assert.match(auxiliaryRuntime, /exports only in-scope orders/);
  assert.match(
    auxiliaryRuntime,
    /rejects pickup without permission and preserves order side effects/,
  );
  assert.match(
    auxiliaryRuntime,
    /rejects out-of-scope pickup and preserves order side effects/,
  );
});


test('defines the focused pickup verification command and closes generic picked writes', () => {
  const pickupCommand = read(
    'apps/api/src/modules/order/admin-pickup-verification-command.ts',
  );
  const statusCommand = read(
    'apps/api/src/modules/order/admin-order-status-command.ts',
  );
  assert.match(
    pickupCommand,
    /admin\.order\.pickup\.verify\.v1/,
  );
  assert.match(pickupCommand, /expected_version/);
  assert.match(pickupCommand, /idempotency_key/);
  assert.match(pickupCommand, /admin_remark/);
  assert.doesNotMatch(
    statusCommand,
    /OrderStatus\.picked/,
  );
  assert.doesNotMatch(
    statusCommand,
    /\| 'picked'/,
  );
});


test('requires one V1 pickup verification write boundary and no legacy mutation', () => {
  const adminOrders = read('apps/api/src/routes/admin/orders.ts');
  const fulfillment = read('apps/api/src/routes/fulfillment.ts');
  const orderService = read('apps/api/src/modules/order/order-service.ts');
  const executor = read(
    'apps/api/src/modules/order/admin-pickup-verification-executor.ts',
  );

  assert.match(
    adminOrders,
    /'\/api\/admin\/orders\/:id\/pickup-verify'/,
  );
  assert.match(
    adminOrders,
    /requireAdminPermissionV1\('pickup\.verify'\)/,
  );
  assert.match(adminOrders, /parseAdminPickupVerificationCommand/);
  assert.match(adminOrders, /executeAdminPickupVerificationCommand/);
  assert.match(adminOrders, /ADMIN_PICKUP_VERIFIED/);
  assert.doesNotMatch(
    fulfillment,
    /\/api\/admin\/orders\/:id\/pickup-verify/,
  );
  assert.doesNotMatch(fulfillment, /\bpickupVerify\b/);
  assert.doesNotMatch(
    orderService,
    /export async function pickupVerify/,
  );
  assert.doesNotMatch(
    executor,
    /safeRecord(?:BusinessEvent|OrderTimeline)/,
  );
  assert.match(executor, /await recordBusinessEvent\(tx,/);
  assert.match(executor, /await recordOrderTimeline\(tx,/);
  assert.match(executor, /await recordAdminAudit\(tx,/);
  assert.match(executor, /await tx\.adminCommandReceipt\.update\(/);
});
