import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function read(path: string) { return readFileSync(join(process.cwd(), path), 'utf8'); }
function includesAll(source: string, values: string[], label: string) { for (const value of values) assert(source.includes(value), `${label} missing ${value}`); }
function extractMainExecutionSource(source: string) {
  const mainStart = source.indexOf('async function main()');
  assert(mainStart >= 0, 'Docker E2E main function missing');

  const mainInvocation = source.indexOf('\nmain().catch', mainStart);
  assert(mainInvocation > mainStart, 'Docker E2E main invocation missing');

  return source.slice(mainStart, mainInvocation);
}

function assertDockerFixtureBeforeAdminRequests(source: string) {
  const dockerMain = extractMainExecutionSource(source);
  const fixtureCall = 'await ensureDockerE2eFixtures(prisma);';
  const fixtureIndex = dockerMain.indexOf(fixtureCall);
  const firstAdminRequestIndex = dockerMain.indexOf('/api/admin/');

  assert(fixtureIndex >= 0, 'Docker E2E fixture call missing from main execution path');
  assert(firstAdminRequestIndex >= 0, 'Docker E2E admin request missing from main execution path');
  assert(fixtureIndex < firstAdminRequestIndex, 'Docker E2E fixture must run before admin requests');
}

const regressionFixture = `
async function helper() {
  await request('GET', '/api/admin/helper-only');
}

async function main() {
  await ensureDockerE2eFixtures(prisma);
  await request('GET', '/api/health');
  await request('GET', '/api/admin/orders');
}

main().catch(() => {});
`;

assertDockerFixtureBeforeAdminRequests(regressionFixture);

const adminOrdersRoute = read('apps/api/src/routes/admin/orders.ts');
const afterSalesRoute = read('apps/api/src/routes/after-sales.ts');
const adminOrderApi = read('apps/admin/src/api/adminOrders.ts');
const adminAfterSaleApi = read('apps/admin/src/api/adminAfterSales.ts');
const orderPage = read('apps/admin/src/pages/orders/AdminOrderDetailPage.tsx');
const workbenchPage = read('apps/admin/src/pages/after-sales/AfterSaleWorkbenchPage.tsx');
const stageWorkflow = read('scripts/stage-workflow.ts');
const dockerE2e = read('scripts/verify-docker-api-e2e-local.ts');
const fixtures = read('scripts/lib/docker-e2e-fixtures.ts');
const afterSaleService = read('apps/api/src/modules/after-sale/after-sale-service.ts');

assert(adminOrdersRoute.includes("/api/admin/orders/:id"), 'Admin order detail API missing');
assert(adminOrdersRoute.includes("requireAdminPermission('order.view')"), 'Admin order detail must require order.view');
assert(afterSalesRoute.includes("/api/admin/after-sales"), 'Admin after-sale list API missing');
assert(afterSalesRoute.includes("requireAdminPermission('after_sale.manage')"), 'Admin after-sale APIs must require after_sale.manage');
assert(afterSalesRoute.includes("/api/admin/after-sales/:id/review"), 'Admin after-sale review API missing');
assert(afterSalesRoute.includes("requireAdminPermission(['after_sale.manage', 'refund.manage'])"), 'Review action must require after_sale.manage or refund.manage');
assert(adminOrdersRoute.includes('canAccessOrderDataScope') && afterSalesRoute.includes('getScopedOrderWhere') && afterSalesRoute.includes('canAccessOrderDataScope'), 'Admin data scope must protect order and after-sale data');
assert(adminOrdersRoute.includes('receiver_phone_masked') && afterSalesRoute.includes('receiver_phone_masked'), 'Phone must be masked in admin responses');
assert(adminOrdersRoute.includes('receiver_address_masked') && afterSalesRoute.includes('receiver_address_masked'), 'Address must be masked by default');

includesAll(adminOrdersRoute + afterSalesRoute + adminOrderApi + adminAfterSaleApi + orderPage + workbenchPage, [
  'product_refund_amount_cents', 'delivery_refund_amount_cents', 'refund_amount_cents', 'remaining_refundable_amount_cents',
  'requested_product_refund_cents', 'requested_delivery_refund_cents', 'approved_product_refund_cents', 'approved_delivery_refund_cents'
], 'L39 refund split fields');
includesAll(workbenchPage, ['状态筛选', '类型筛选', '订单号搜索', '审核通过', '审核拒绝', '人工备注'], 'After-sale workbench UI');

const runtimeFiles = [adminOrdersRoute, afterSalesRoute, adminOrderApi, adminAfterSaleApi, orderPage, workbenchPage];
const joinedRuntime = runtimeFiles.join('\n');
for (const forbidden of ['cost_price_cents', 'commission_value', 'commission_type', 'stock_deduct_quantity', 'password_hash', 'private_key', 'totp_secret']) {
  assert(!joinedRuntime.includes(forbidden), `Sensitive field leaked in runtime files: ${forbidden}`);
}
assert(!joinedRuntime.includes('createMockRefund('), 'L40 review workbench must not trigger mock/real refund');
assert(!/wechat.*refund|refund.*wechat/i.test(joinedRuntime), 'L40 runtime must not integrate real WeChat refund');
assert(!/auto.*payout|自动打款/.test(joinedRuntime), 'L40 runtime must not implement automatic payout');
assert(!/auto.*tax|自动报税/.test(joinedRuntime), 'L40 runtime must not implement automatic tax filing');

assert(fixtures.includes('DOCKER_E2E_ADMIN_ID') && fixtures.includes('docker-e2e-admin') && fixtures.includes('prisma.adminUser.upsert'), 'Docker E2E admin fixture must upsert deterministic admin');
assertDockerFixtureBeforeAdminRequests(dockerE2e);
assert(afterSaleService.includes('requireExistingAdmin') && afterSaleService.includes('缺少管理员身份') && afterSaleService.includes('管理员不存在或已停用'), 'After-sale service must validate admin identity before FK writes');
assert(afterSaleService.includes('mapAdminForeignKeyError') && afterSaleService.includes('reviewed_by_admin: { connect') && afterSaleService.includes('resolved_by_admin: { connect'), 'After-sale service must map admin FK errors and connect validated admin relations');
const dockerAuthSources = `${dockerE2e}
${fixtures}`;
assert(fixtures.includes('DOCKER_E2E_ADMIN_ID') && fixtures.includes('prisma.adminUser.upsert') && fixtures.includes("status: 'active'"), 'Docker E2E deterministic admin fixture missing');
assert(fixtures.includes('DOCKER_E2E_INACTIVE_ADMIN_ID') && fixtures.includes("role: 'super_admin'") && fixtures.includes("status: 'inactive'"), 'Docker E2E inactive admin fixture missing');
assert(fixtures.includes('DOCKER_E2E_OPERATOR_ADMIN_ID') && fixtures.includes("role: 'operator'") && fixtures.includes("status: 'active'"), 'Docker E2E operator admin fixture missing');
assert(fixtures.includes('DOCKER_E2E_STORE_MANAGER_ADMIN_ID') && fixtures.includes("role: 'store_manager'") && fixtures.includes("status: 'active'"), 'Docker E2E store manager admin fixture missing');
assert(dockerAuthSources.includes('missing admin fixture') && dockerAuthSources.includes('expectedStatus: 401') && dockerAuthSources.includes('ADMIN_UNAUTHORIZED'), 'Docker E2E missing-admin 401 coverage missing');
assert(dockerAuthSources.includes('inactive admin') && dockerAuthSources.includes('expectedStatus: 401') && dockerAuthSources.includes('ADMIN_UNAUTHORIZED'), 'Docker E2E inactive-admin 401 coverage missing');
assert(dockerAuthSources.includes('insufficient permission') && dockerAuthSources.includes('expectedStatus: 403') && dockerAuthSources.includes('ADMIN_FORBIDDEN'), 'Docker E2E permission-denied 403 coverage missing');
assert(dockerAuthSources.includes('cross pickup scope') && dockerAuthSources.includes('expectedStatus: 403') && dockerAuthSources.includes('ADMIN_SCOPE_FORBIDDEN'), 'Docker E2E data-scope 403 coverage missing');
assert(dockerE2e.includes('reviewed_by_admin_id') && dockerE2e.includes('resolved_by_admin_id') && dockerE2e.includes('DOCKER_E2E_ADMIN_ID'), 'Docker E2E deterministic reviewer/resolver coverage missing');
assert(stageWorkflow.includes('L40') && stageWorkflow.includes('verify-l40-admin-order-after-sale-workbench-local.ts'), 'L40 must be registered in stage workflow');
assert(read('scripts/verify-all-local.sh').includes('verify-l40-admin-order-after-sale-workbench-local.ts'), 'verify-all must include L40');
assert(existsSync(join(process.cwd(), 'docs/reviews/l40-admin-order-after-sale-workbench.md')), 'L40 review doc missing');
console.log('L40 admin order after sale workbench verification passed.');
