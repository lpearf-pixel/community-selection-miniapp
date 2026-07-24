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
  const pickupWorkbench = read('apps/api/src/routes/admin/pickup.ts');
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
    pickupWorkbench,
    /app\.post\('\/api\/admin\/pickup\/orders\/:id\/verify'/,
  );
  assert.doesNotMatch(
    pickupWorkbench,
    /order_status:\s*OrderStatus\.picked/,
  );
  assert.doesNotMatch(
    pickupWorkbench,
    /safeRecord(?:BusinessEvent|OrderTimeline)/,
  );
  assert.doesNotMatch(
    orderService,
    /export async function pickupVerify/,
  );
  assert.doesNotMatch(
    orderService,
    /allowedFulfillmentStatuses[\s\S]{0,240}OrderStatus\.picked/,
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


test('exposes only the eligible pickup action and refreshes pickup conflicts', () => {
  const api = read('apps/admin/src/features/sales/orders/api.ts');
  const page = read(
    'apps/admin/src/features/sales/orders/OrdersPage.tsx',
  );
  const pickupHook = read(
    'apps/admin/src/features/sales/orders/usePickupVerification.ts',
  );
  const table = read(
    'apps/admin/src/features/sales/orders/OrdersTable.tsx',
  );
  const types = read('apps/admin/src/features/sales/orders/types.ts');

  assert.match(types, /AdminPickupVerificationResult/);
  assert.match(api, /expected_version:\s*expectedVersion/);
  assert.match(api, /idempotency_key:\s*idempotencyKey/);
  assert.match(page, /usePickupVerification/);
  assert.match(pickupHook, /verifyOrderPickup\([\s\S]*?order\.version/);
  assert.match(pickupHook, /crypto\.randomUUID\(\)/);
  assert.match(pickupHook, /ADMIN_PICKUP_TYPE_CONFLICT/);
  assert.match(pickupHook, /ADMIN_PICKUP_STATE_CONFLICT/);
  assert.match(pickupHook, /ADMIN_ORDER_VERSION_CONFLICT/);
  assert.match(pickupHook, /pendingPickupOrderIds/);
  assert.match(pickupHook, /useRef<Set<string>>/);
  assert.match(pickupHook, /pendingPickupOrderIdsRef\.current\.has\(order\.id\)/);
  assert.match(pickupHook, /pendingPickupOrderIdsRef\.current\.add\(order\.id\)/);
  assert.match(pickupHook, /pendingPickupOrderIdsRef\.current\.delete\(order\.id\)/);
  assert.match(
    table,
    /order\.pickup_type === 'store'\s*&&\s*order\.order_status === 'ready'/,
  );
  assert.match(table, /disabled=\{props\.pendingPickupOrderIds\.has\(order\.id\)\}/);
  assert.doesNotMatch(table, /onMarkOrder\(order, 'picked'\)/);
  assert.doesNotMatch(table, /已自提/);
});


test('proves eligible pickup UI and deterministic real browser conflict', () => {
  const fixture = read('scripts/admin-e2e/fixture.ts');
  const runner = read('scripts/admin-e2e/run.cjs');
  const smoke = read('scripts/admin-e2e/admin-smoke.mjs');

  assert.match(
    runner,
    /ADMIN_E2E_RUN_ID:\s*projectSuffix/,
  );
  assert.match(
    fixture,
    /process\.env\.ADMIN_E2E_RUN_ID\s*\?\?\s*process\.env\.GITHUB_RUN_ID/,
  );
  assert.match(fixture, /pickupOrderNo/);
  assert.match(fixture, /pickup_type:\s*'store'/);
  assert.match(fixture, /order_status:\s*'ready'/);
  assert.match(smoke, /credentials\.pickupOrderNo/);
  assert.match(smoke, /deliveryRow[\s\S]*?核销自提[\s\S]*?count\(\)/);
  assert.match(
    smoke,
    /await page\.route\('\*\*\/api\/admin\/orders\/\*\/pickup-verify', pickupRaceRoute\);/,
  );
  assert.match(smoke, /await route\.fetch\(\)/);
  assert.match(smoke, /const pickupConflictPage = await context\.newPage\(\)/);
  assert.match(
    smoke,
    /sameVersionPickupButton\.dispatchEvent\('click'\)[\s\S]*?conflictVersionPickupButton\.dispatchEvent\('click'\)/,
  );
  assert.match(smoke, /assert\.deepEqual\(pickupRaceCodes, \[200, 409\]\);/);
  assert.match(smoke, /'pickup success refresh'/);
  assert.match(smoke, /'pickup conflict refresh'/);
  assert.match(smoke, /ADMIN_PICKUP_STATE_CONFLICT/);
});


test('routes the pickup workbench through the reliable command', () => {
  const pickupRoutes = read('apps/api/src/routes/admin/pickup.ts');
  const pickupApi = read('apps/admin/src/api/pickupWorkbench.ts');
  const pickupPage = read(
    'apps/admin/src/pages/pickup/PickupWorkbenchPage.tsx',
  );

  assert.match(pickupRoutes, /pickup_type:\s*order\.pickup_type/);
  assert.match(pickupRoutes, /version:\s*order\.version/);
  assert.match(
    pickupRoutes,
    /PickupType\.store/,
  );
  assert.doesNotMatch(
    pickupRoutes,
    /app\.post\('\/api\/admin\/pickup\/orders\/:id\/verify'/,
  );
  assert.match(
    pickupApi,
    /\/api\/admin\/orders\/\$\{orderId\}\/pickup-verify/,
  );
  assert.match(pickupApi, /expected_version:\s*expectedVersion/);
  assert.match(pickupApi, /idempotency_key:\s*idempotencyKey/);
  assert.match(pickupApi, /class PickupWorkbenchApiError extends Error/);
  assert.match(pickupApi, /public readonly code:/);
  assert.doesNotMatch(
    pickupApi,
    /\/api\/admin\/pickup\/orders\/\$\{orderId\}\/verify/,
  );
  assert.match(
    pickupPage,
    /order\.pickup_type === "store"\s*&&\s*order\.order_status === "ready"/,
  );
  assert.match(
    pickupPage,
    /verifyPickupWorkbenchOrder\([\s\S]*?order\.version[\s\S]*?crypto\.randomUUID\(\)/,
  );
  assert.match(pickupPage, /ADMIN_PICKUP_TYPE_CONFLICT/);
  assert.match(pickupPage, /ADMIN_PICKUP_STATE_CONFLICT/);
  assert.match(pickupPage, /ADMIN_ORDER_VERSION_CONFLICT/);
  assert.match(
    pickupPage,
    /setSelectedOrder\(\(current\)[\s\S]*?current\?\.order_id === order\.order_id[\s\S]*?null/,
  );
});


test('keeps the legacy migration exception exact and comment-only', () => {
  const checker = read('scripts/check-migrations.ts');
  const migration = read(
    'prisma/migrations/20260714000200_l44_withdrawal_commission_links/migration.sql',
  );

  assert.match(
    checker,
    /'20260714000200_l44_withdrawal_commission_links':[\s\S]{0,160}Rollback \(manual\): DROP TABLE "WithdrawalCommission"/,
  );
  assert.match(checker, /sql\.replace\(auditedComment, ''\)/);
  assert.match(
    migration,
    /^-- Rollback \(manual\): DROP TABLE "WithdrawalCommission"; no historical Withdrawal\/Commission rows are modified\.$/m,
  );
});


test('keeps compliance exclusions narrow and deployable code scanned', () => {
  const scanner = read('scripts/compliance-scan.ts');

  assert.match(scanner, /\^scripts\\\/\(\?:verify-/);
  assert.match(scanner, /\^prisma\\\/migrations/);
  assert.match(scanner, /\\\.\(\?:test\|spec\)/);
  assert.doesNotMatch(scanner, /\^scripts\(\?:\\\/\|\$\)/);
  const excludedPaths = scanner.slice(
    scanner.indexOf('const excludedPaths'),
    scanner.indexOf('const forbidden'),
  );
  assert.doesNotMatch(excludedPaths, /\^apps|\^packages/);
  assert.match(scanner, /const levelTerm = \['le', 'vel'\]\.join\(''\)/);
  assert.match(scanner, /level=\\\{\\d\+\\\}\\s\*\\\$\//);
  assert.match(
    scanner,
    /path === 'apps\/admin\/src\/app\/AdminShell\.tsx'[\s\S]{0,120}level=/,
  );
});
