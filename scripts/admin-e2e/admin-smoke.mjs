import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.ADMIN_E2E_BASE_URL ?? 'http://127.0.0.1:13081';
const credentials = JSON.parse(await readFile(new URL('./.fixture.json', import.meta.url), 'utf8'));
const navigation = [
  '商品管理', '团购管理', '失败团购人工关闭', '订单管理', '履约看板',
  '库存管理', '采购计划', '供应商管理', '批次库存', '临期提醒',
  '库存盘点', '售后客服', '提现管理', '告警中心', '税务人工 Review',
  '经营驾驶舱 V2', '财务对账', '退款台账', '开团服务奖励', '运营看板',
  '自提工作台', '配送预留', '管理配送规则',
];

async function waitForCount(page, readCount, minimum, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (readCount() >= minimum) return;
    await page.waitForTimeout(100);
  }
  assert.fail(`${label}: expected at least ${minimum}, received ${readCount()}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let catalogRequestCount = 0;
let categoryRequestCount = 0;
let productRequestCount = 0;
let financeRequestCount = 0;
let operationsRequestCount = 0;
let groupBuyRequestCount = 0;
let orderRequestCount = 0;
let fulfillmentRequestCount = 0;
let afterSalesRequestCount = 0;
let inventoryOverviewRequestCount = 0;
let purchasePlanRequestCount = 0;
let supplierRequestCount = 0;
let batchRequestCount = 0;
let expiryAlertRequestCount = 0;
let stockCheckRequestCount = 0;
let withdrawalRequestCount = 0;
let alertRequestCount = 0;
let taxReviewRequestCount = 0;
let catalogFailureInjected = false;
let operationsFailureInjected = false;
let orderFailureInjected = false;
let purchasePlanFailureInjected = false;
let alertFailureInjected = false;

page.on('request', (request) => {
  const requestUrl = new URL(request.url());
  const { pathname } = requestUrl;
  if (pathname === '/api/categories') {
    categoryRequestCount += 1;
    catalogRequestCount += 1;
  }
  if (pathname === '/api/products') {
    productRequestCount += 1;
    catalogRequestCount += 1;
  }
  if (pathname.startsWith('/api/admin/finance/reconciliation/')) {
    financeRequestCount += 1;
  }
  if (pathname.startsWith('/api/admin/operations/dashboard/')) {
    operationsRequestCount += 1;
  }
  if (pathname === '/api/group-buys') {
    groupBuyRequestCount += 1;
  }
  if (pathname === '/api/admin/orders') {
    orderRequestCount += 1;
  }
  if (pathname === '/api/admin/fulfillment/overview') {
    fulfillmentRequestCount += 1;
  }
  if (pathname === '/api/admin/after-sales') {
    afterSalesRequestCount += 1;
  }
  if (pathname === '/api/admin/inventory/overview') {
    inventoryOverviewRequestCount += 1;
  }
  if (pathname === '/api/admin/purchase-plans') {
    purchasePlanRequestCount += 1;
  }
  if (pathname === '/api/admin/suppliers') {
    supplierRequestCount += 1;
  }
  if (pathname === '/api/admin/inventory/batches') {
    batchRequestCount += 1;
  }
  if (
    pathname === '/api/admin/inventory/expiry-alerts' &&
    requestUrl.search === '?days=7'
  ) {
    expiryAlertRequestCount += 1;
  }
  if (pathname === '/api/admin/stock-checks') {
    stockCheckRequestCount += 1;
  }
  if (pathname === '/api/admin/withdrawals') {
    withdrawalRequestCount += 1;
  }
  if (pathname === '/api/admin/logs/alerts') {
    alertRequestCount += 1;
  }
  if (pathname === '/api/admin/tax-records') {
    taxReviewRequestCount += 1;
  }
});

try {
  const unauthenticatedOrdersResponse = await context.request.get(
    `${baseURL}/api/admin/orders?page=1&page_size=20`,
  );
  assert.equal(unauthenticatedOrdersResponse.status(), 401);
  const unauthenticatedOrdersEnvelope =
    await unauthenticatedOrdersResponse.json();
  assert.equal(unauthenticatedOrdersEnvelope.success, false);
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByText('后台登录', { exact: true }).waitFor();
  await page.getByLabel('用户名').fill(credentials.username);
  await page.getByLabel('密码').fill(credentials.password);
  const initialOrdersResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/admin/orders' &&
      response.ok(),
  );
  await page.getByRole('button', { name: /登\s*录/ }).click();
  const initialOrdersResponse = await initialOrdersResponsePromise;
  const initialOrdersEnvelope = await initialOrdersResponse.json();
  assert.equal(initialOrdersEnvelope.success, true);
  assert.equal(initialOrdersEnvelope.code, 'ADMIN_ORDERS_LISTED');
  assert.equal(typeof initialOrdersEnvelope.trace_id, 'string');
  assert.equal(Array.isArray(initialOrdersEnvelope.data.items), true);
  assert.equal(
    typeof initialOrdersEnvelope.data.pagination.total,
    'number',
  );
  assert.ok(initialOrdersEnvelope.data.items.length > 0);
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.getByText(`当前管理员：${credentials.username}`).waitFor();
  const roleWorkbench = page.getByRole('region', {
    name: '今日经营角色工作台',
  });
  await roleWorkbench.waitFor();
  await waitForCount(
    page,
    () => operationsRequestCount,
    6,
    'role-workbench operations load',
  );
  await page.getByText('近 7 日趋势表', { exact: true }).waitFor();
  await roleWorkbench
    .getByText('当前工作台：经营负责人', { exact: true })
    .waitFor();
  await waitForCount(page, () => groupBuyRequestCount, 1, 'group-buy initial load');
  await waitForCount(page, () => orderRequestCount, 1, 'order initial load');
  await waitForCount(page, () => fulfillmentRequestCount, 1, 'fulfillment initial load');
  await waitForCount(page, () => afterSalesRequestCount, 1, 'after-sales initial load');
  await waitForCount(page, () => inventoryOverviewRequestCount, 1, 'inventory initial load');
  await waitForCount(page, () => purchasePlanRequestCount, 1, 'purchase-plan initial load');
  await waitForCount(page, () => supplierRequestCount, 1, 'supplier initial load');
  await waitForCount(page, () => batchRequestCount, 1, 'batch initial load');
  await waitForCount(page, () => expiryAlertRequestCount, 1, 'expiry-alert initial load');
  await waitForCount(page, () => stockCheckRequestCount, 1, 'stock-check initial load');
  await waitForCount(page, () => withdrawalRequestCount, 1, 'withdrawal initial load');
  await waitForCount(page, () => alertRequestCount, 1, 'alert initial load');
  await waitForCount(page, () => taxReviewRequestCount, 1, 'tax-review initial load');
  await page.waitForLoadState('networkidle');
  const readA32RequestCounts = () => ({
    groupBuys: groupBuyRequestCount,
    orders: orderRequestCount,
    fulfillment: fulfillmentRequestCount,
    afterSales: afterSalesRequestCount,
  });
  const a32RequestsAfterInitial = readA32RequestCounts();
  const readA33RequestCounts = () => ({
    inventory: inventoryOverviewRequestCount,
    purchasePlans: purchasePlanRequestCount,
    suppliers: supplierRequestCount,
    batches: batchRequestCount,
    expiryAlerts: expiryAlertRequestCount,
    stockChecks: stockCheckRequestCount,
  });
  const a33RequestsAfterInitial = readA33RequestCounts();
  const readA34RequestCounts = () => ({
    withdrawals: withdrawalRequestCount,
    alerts: alertRequestCount,
    taxReview: taxReviewRequestCount,
  });
  const a34RequestsAfterInitial = readA34RequestCounts();
  const readBusinessRequestCounts = () => ({
    catalog: catalogRequestCount,
    finance: financeRequestCount,
    operations: operationsRequestCount,
    ...readA32RequestCounts(),
    ...readA33RequestCounts(),
    ...readA34RequestCounts(),
  });

  const expectedNavigationSections = [
    '今日经营',
    '销售与履约',
    '商品与价格',
    '库存与供应链',
    '财务与结算',
    '数据分析',
    '运维与风控',
  ];
  const groupedNavigation = page.getByRole('navigation', {
    name: '后台功能导航',
  });
  await groupedNavigation.waitFor();
  const visibleNavigationSections = await groupedNavigation
    .getByRole('heading')
    .allTextContents();
  assert.deepEqual(visibleNavigationSections, expectedNavigationSections);
  const hiddenNavigationSections = ['会员与营销', '门店与渠道', '系统管理'];
  for (const label of hiddenNavigationSections) {
    assert.equal(
      await groupedNavigation.getByText(label, { exact: true }).count(),
      0,
    );
  }

  const shell = page.getByRole('region', { name: '社区甄选管理后台' });
  const buttons = groupedNavigation.getByRole('button');
  const assertActive = async (button, label) => {
    const className = await button.getAttribute('class');
    assert.match(className ?? '', /ant-btn-primary/, `${label} did not become active`);
  };
  const workbenchOrdersButton = roleWorkbench.getByRole('button', {
    name: '订单管理',
    exact: true,
  });
  const ordersNavigationButton = groupedNavigation.getByRole('button', {
    name: '订单管理',
    exact: true,
  });
  await workbenchOrdersButton.click();
  await assertActive(ordersNavigationButton, '订单管理');
  const productButton = groupedNavigation.getByRole('button', {
    name: '商品管理',
    exact: true,
  });
  await productButton.click();
  await assertActive(productButton, '商品管理');
  await page.getByText('商品列表', { exact: true }).waitFor();
  operationsRequestCount = 0;
  await waitForCount(page, () => categoryRequestCount, 1, 'category initial load');
  await waitForCount(page, () => productRequestCount, 1, 'product initial load');
  const catalogRequestsAfterInitial = {
    categories: categoryRequestCount,
    products: productRequestCount,
    total: catalogRequestCount,
  };
  assert.equal(
    catalogRequestsAfterInitial.categories,
    catalogRequestsAfterInitial.products,
  );
  assert.equal(
    catalogRequestsAfterInitial.total,
    catalogRequestsAfterInitial.categories + catalogRequestsAfterInitial.products,
  );
  assert.equal(financeRequestCount, 0);
  assert.equal(operationsRequestCount, 0);
  const catalogDraftName = 'E2E 保留商品草稿';
  await page.getByLabel('商品名称').fill(catalogDraftName);

  const catalogRequestsBeforeRefresh = {
    categories: categoryRequestCount,
    products: productRequestCount,
    total: catalogRequestCount,
  };
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await waitForCount(
    page,
    () => categoryRequestCount,
    catalogRequestsBeforeRefresh.categories + 1,
    'category active refresh',
  );
  await waitForCount(
    page,
    () => productRequestCount,
    catalogRequestsBeforeRefresh.products + 1,
    'product active refresh',
  );
  assert.equal(categoryRequestCount, catalogRequestsBeforeRefresh.categories + 1);
  assert.equal(productRequestCount, catalogRequestsBeforeRefresh.products + 1);
  assert.equal(catalogRequestCount, catalogRequestsBeforeRefresh.total + 2);
  assert.equal(financeRequestCount, 0);
  assert.equal(operationsRequestCount, 0);

  await page.route('**/api/categories', async (route) => {
    if (!catalogFailureInjected) {
      catalogFailureInjected = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 'E2E_CATALOG_FAILURE',
          message: '模拟商品目录失败',
        }),
      });
      return;
    }
    await route.continue();
  });

  const catalogRequestsBeforeFailure = {
    categories: categoryRequestCount,
    products: productRequestCount,
    total: catalogRequestCount,
  };
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await page.getByText('商品目录加载失败', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  assert.equal(catalogFailureInjected, true);
  await waitForCount(
    page,
    () => categoryRequestCount,
    catalogRequestsBeforeFailure.categories + 1,
    'category failed refresh',
  );
  await waitForCount(
    page,
    () => productRequestCount,
    catalogRequestsBeforeFailure.products + 1,
    'product failed refresh',
  );
  assert.equal(categoryRequestCount, catalogRequestsBeforeFailure.categories + 1);
  assert.equal(productRequestCount, catalogRequestsBeforeFailure.products + 1);
  assert.equal(catalogRequestCount, catalogRequestsBeforeFailure.total + 2);

  const catalogRequestsBeforeA32 = catalogRequestCount;
  const financeRequestsBeforeA32 = financeRequestCount;
  const operationsRequestsBeforeA32 = operationsRequestCount;
  assert.deepEqual(readA32RequestCounts(), a32RequestsAfterInitial);

  const groupBuysButton = groupedNavigation.getByRole('button', {
    name: '团购管理',
    exact: true,
  });
  await groupBuysButton.click();
  await assertActive(groupBuysButton, '团购管理');
  await page.getByText('团购列表', { exact: true }).waitFor();

  const a32RequestsBeforeGroupBuyRefresh = readA32RequestCounts();
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await waitForCount(
    page,
    () => groupBuyRequestCount,
    a32RequestsBeforeGroupBuyRefresh.groupBuys + 1,
    'group-buy active refresh',
  );
  assert.equal(
    groupBuyRequestCount,
    a32RequestsBeforeGroupBuyRefresh.groupBuys + 1,
  );
  assert.equal(orderRequestCount, a32RequestsBeforeGroupBuyRefresh.orders);
  assert.equal(
    fulfillmentRequestCount,
    a32RequestsBeforeGroupBuyRefresh.fulfillment,
  );
  assert.equal(
    afterSalesRequestCount,
    a32RequestsBeforeGroupBuyRefresh.afterSales,
  );
  assert.equal(catalogRequestCount, catalogRequestsBeforeA32);
  assert.equal(financeRequestCount, financeRequestsBeforeA32);
  assert.equal(operationsRequestCount, operationsRequestsBeforeA32);

  const ordersButton = groupedNavigation.getByRole('button', {
    name: '订单管理',
    exact: true,
  });
  await ordersButton.click();
  await assertActive(ordersButton, '订单管理');
  await page.getByText('全渠道订单', { exact: true }).waitFor();

  const orderFilter = page.getByRole('form', {
    name: '全渠道订单筛选',
  });
  const firstOrderNo = initialOrdersEnvelope.data.items[0].order_no;
  assert.equal(firstOrderNo, credentials.orderNo);
  await orderFilter.getByLabel('订单关键词').fill(firstOrderNo);
  const filteredOrdersResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/admin/orders' &&
      url.searchParams.get('keyword') === firstOrderNo &&
      url.searchParams.get('page') === '1' &&
      response.ok()
    );
  });
  await orderFilter
    .getByRole('button', { name: /查\s*询/ })
    .click();
  const filteredOrdersEnvelope = await (
    await filteredOrdersResponse
  ).json();
  assert.equal(filteredOrdersEnvelope.success, true);
  assert.equal(Array.isArray(filteredOrdersEnvelope.data.items), true);
  assert.ok(filteredOrdersEnvelope.data.items.length > 0);
  const invalidOrdersResponse = await context.request.get(
    `${baseURL}/api/admin/orders?pay_status=unknown`,
  );
  assert.equal(invalidOrdersResponse.status(), 400);
  const invalidOrdersEnvelope = await invalidOrdersResponse.json();
  assert.equal(
    invalidOrdersEnvelope.code,
    'INVALID_ADMIN_ORDER_QUERY',
  );
  assert.equal(typeof invalidOrdersEnvelope.trace_id, 'string');
  const oversizedPageResponse = await context.request.get(
    `${baseURL}/api/admin/orders?page=10001&page_size=100`,
  );
  assert.equal(oversizedPageResponse.status(), 400);
  const oversizedPageEnvelope = await oversizedPageResponse.json();
  assert.equal(
    oversizedPageEnvelope.code,
    'INVALID_ADMIN_ORDER_QUERY',
  );
  assert.equal(typeof oversizedPageEnvelope.trace_id, 'string');
  const filteredOrder = filteredOrdersEnvelope.data.items[0];
  assert.equal(Object.hasOwn(filteredOrder, 'receiver_phone'), false);
  assert.equal(Object.hasOwn(filteredOrder, 'receiver_address'), false);
  await page.getByRole('columnheader', { name: '渠道' }).waitFor();
  await page.getByText('微信小程序', { exact: true }).first().waitFor();
  assert.equal(filteredOrder.id, credentials.orderId);
  assert.equal(filteredOrder.version, 1);

  const fixtureRow = page
    .getByRole('row')
    .filter({ hasText: credentials.orderNo });
  const statusResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname ===
      `/api/admin/orders/${credentials.orderId}/status`,
  );
  const refreshedOrderPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/admin/orders' &&
      url.searchParams.get('keyword') === credentials.orderNo &&
      response.ok()
    );
  });
  await fixtureRow.getByRole('button', { name: '待自提' }).click();
  const statusResponse = await statusResponsePromise;
  const statusRequest = statusResponse.request();
  assert.equal(statusRequest.method(), 'POST');
  const statusCommand = statusRequest.postDataJSON();
  assert.equal(statusCommand.next_status, 'ready');
  assert.equal(statusCommand.expected_version, 1);
  assert.match(
    statusCommand.idempotency_key,
    /^[\x21-\x7e]{16,128}$/,
  );
  assert.equal(statusResponse.status(), 200);
  const statusEnvelope = await statusResponse.json();
  assert.equal(statusEnvelope.success, true);
  assert.equal(statusEnvelope.code, 'ADMIN_ORDER_STATUS_UPDATED');
  assert.equal(statusEnvelope.data.order_id, credentials.orderId);
  assert.equal(statusEnvelope.data.order_status, 'ready');
  assert.equal(statusEnvelope.data.version, 2);
  await refreshedOrderPromise;
  await fixtureRow.getByText('ready', { exact: true }).waitFor();

  const orderFailureRoute = async (route) => {
    assert.equal(route.request().method(), 'GET');
    assert.equal(orderFailureInjected, false);
    orderFailureInjected = true;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        code: 'E2E_ORDER_FAILURE',
        message: '模拟订单列表失败',
      }),
    });
  };
  await page.route('**/api/admin/orders*', orderFailureRoute);
  const a32RequestsBeforeOrderFailure = readA32RequestCounts();
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await page.getByText('订单列表加载失败', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.getByRole('button', { name: /刷\s*新/ }).waitFor();
  await page.getByRole('button', { name: '退出登录', exact: true }).waitFor();
  assert.equal(orderFailureInjected, true);
  await waitForCount(
    page,
    () => orderRequestCount,
    a32RequestsBeforeOrderFailure.orders + 1,
    'order failed refresh',
  );
  assert.equal(
    groupBuyRequestCount,
    a32RequestsBeforeOrderFailure.groupBuys,
  );
  assert.equal(orderRequestCount, a32RequestsBeforeOrderFailure.orders + 1);
  assert.equal(
    fulfillmentRequestCount,
    a32RequestsBeforeOrderFailure.fulfillment,
  );
  assert.equal(
    afterSalesRequestCount,
    a32RequestsBeforeOrderFailure.afterSales,
  );
  await page.unroute('**/api/admin/orders*', orderFailureRoute);

  const afterSalesButton = groupedNavigation.getByRole('button', {
    name: '售后客服',
    exact: true,
  });
  const a32RequestsDuringOrderError = readA32RequestCounts();
  await afterSalesButton.click();
  await assertActive(afterSalesButton, '售后客服');
  await page.getByRole('columnheader', { name: '售后单' }).waitFor();
  assert.equal(await page.getByText('售后客服加载失败').count(), 0);
  assert.deepEqual(readA32RequestCounts(), a32RequestsDuringOrderError);

  await ordersButton.click();
  await assertActive(ordersButton, '订单管理');
  await page.getByText('订单列表加载失败', { exact: true }).waitFor();

  const a32RequestsBeforeOrderRetry = readA32RequestCounts();
  const orderRetryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/admin/orders' && response.ok(),
  );
  await page.getByRole('button', { name: /重\s*试/ }).click();
  const orderResponse = await orderRetryResponse;
  const orderEnvelope = await orderResponse.json();
  assert.equal(orderEnvelope.success, true);
  assert.equal(Array.isArray(orderEnvelope.data.items), true);
  await page.getByText('正在刷新订单列表…').waitFor({ state: 'detached' });
  await page.getByText('订单列表加载失败').waitFor({ state: 'detached' });
  await page.getByText('全渠道订单', { exact: true }).waitFor();
  await waitForCount(
    page,
    () => orderRequestCount,
    a32RequestsBeforeOrderRetry.orders + 1,
    'order retry',
  );
  assert.equal(
    groupBuyRequestCount,
    a32RequestsBeforeOrderRetry.groupBuys,
  );
  assert.equal(orderRequestCount, a32RequestsBeforeOrderRetry.orders + 1);
  assert.equal(
    fulfillmentRequestCount,
    a32RequestsBeforeOrderRetry.fulfillment,
  );
  assert.equal(
    afterSalesRequestCount,
    a32RequestsBeforeOrderRetry.afterSales,
  );
  assert.equal(catalogRequestCount, catalogRequestsBeforeA32);
  assert.equal(financeRequestCount, financeRequestsBeforeA32);
  assert.equal(operationsRequestCount, operationsRequestsBeforeA32);
  assert.deepEqual(readA33RequestCounts(), a33RequestsAfterInitial);

  const inventoryButton = groupedNavigation.getByRole('button', {
    name: '库存管理',
    exact: true,
  });
  await inventoryButton.click();
  await assertActive(inventoryButton, '库存管理');
  await page.getByRole('columnheader', { name: '商品名' }).waitFor();

  const businessRequestsBeforeInventoryRefresh = readBusinessRequestCounts();
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await waitForCount(
    page,
    () => inventoryOverviewRequestCount,
    businessRequestsBeforeInventoryRefresh.inventory + 1,
    'inventory active refresh',
  );
  assert.deepEqual(readBusinessRequestCounts(), {
    ...businessRequestsBeforeInventoryRefresh,
    inventory: businessRequestsBeforeInventoryRefresh.inventory + 1,
  });

  const purchasePlansButton = groupedNavigation.getByRole('button', {
    name: '采购计划',
    exact: true,
  });
  await purchasePlansButton.click();
  await assertActive(purchasePlansButton, '采购计划');
  await page.getByRole('columnheader', { name: '计划编号' }).waitFor();

  const purchasePlanFailureRoute = async (route) => {
    assert.equal(route.request().method(), 'GET');
    assert.equal(purchasePlanFailureInjected, false);
    purchasePlanFailureInjected = true;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        code: 'E2E_PURCHASE_PLAN_FAILURE',
        message: '模拟采购计划列表失败',
      }),
    });
  };
  await page.route('**/api/admin/purchase-plans', purchasePlanFailureRoute);
  const businessRequestsBeforePurchaseFailure = readBusinessRequestCounts();
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await page.getByText('采购计划加载失败', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.getByRole('button', { name: /刷\s*新/ }).waitFor();
  await page.getByRole('button', { name: '退出登录', exact: true }).waitFor();
  assert.equal(purchasePlanFailureInjected, true);
  await waitForCount(
    page,
    () => purchasePlanRequestCount,
    businessRequestsBeforePurchaseFailure.purchasePlans + 1,
    'purchase-plan failed refresh',
  );
  assert.deepEqual(readBusinessRequestCounts(), {
    ...businessRequestsBeforePurchaseFailure,
    purchasePlans: businessRequestsBeforePurchaseFailure.purchasePlans + 1,
  });
  await page.unroute('**/api/admin/purchase-plans', purchasePlanFailureRoute);

  const batchesButton = groupedNavigation.getByRole('button', {
    name: '批次库存',
    exact: true,
  });
  const businessRequestsDuringPurchaseError = readBusinessRequestCounts();
  await batchesButton.click();
  await assertActive(batchesButton, '批次库存');
  await page.getByRole('columnheader', { name: '批次号' }).waitFor();
  assert.equal(await page.getByText('批次库存加载失败').count(), 0);
  assert.deepEqual(readBusinessRequestCounts(), businessRequestsDuringPurchaseError);

  await purchasePlansButton.click();
  await assertActive(purchasePlansButton, '采购计划');
  await page.getByText('采购计划加载失败', { exact: true }).waitFor();
  assert.deepEqual(readBusinessRequestCounts(), businessRequestsDuringPurchaseError);

  const businessRequestsBeforePurchaseRetry = readBusinessRequestCounts();
  const purchasePlanRetryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/admin/purchase-plans' &&
    response.ok(),
  );
  await page.getByRole('button', { name: /重\s*试/ }).click();
  const purchasePlanResponse = await purchasePlanRetryResponse;
  const purchasePlanEnvelope = await purchasePlanResponse.json();
  assert.equal(purchasePlanEnvelope.success, true);
  assert.equal(Array.isArray(purchasePlanEnvelope.data), true);
  await page.getByText('正在刷新采购计划…').waitFor({ state: 'detached' });
  await page.getByText('采购计划加载失败').waitFor({ state: 'detached' });
  await page.getByRole('columnheader', { name: '计划编号' }).waitFor();
  await waitForCount(
    page,
    () => purchasePlanRequestCount,
    businessRequestsBeforePurchaseRetry.purchasePlans + 1,
    'purchase-plan retry',
  );
  assert.deepEqual(readBusinessRequestCounts(), {
    ...businessRequestsBeforePurchaseRetry,
    purchasePlans: businessRequestsBeforePurchaseRetry.purchasePlans + 1,
  });

  await productButton.click();
  await assertActive(productButton, '商品管理');
  await page.getByText('商品目录加载失败', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('商品名称').inputValue(), catalogDraftName);

  const catalogRequestsAfterFailure = {
    categories: categoryRequestCount,
    products: productRequestCount,
    total: catalogRequestCount,
  };
  const categoryRetryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/categories' && response.ok(),
  );
  const productRetryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/products' && response.ok(),
  );
  await page.getByRole('button', { name: /重\s*试/ }).click();
  const [categoryResponse, productResponse] = await Promise.all([
    categoryRetryResponse,
    productRetryResponse,
  ]);
  const [categoryEnvelope, productEnvelope] = await Promise.all([
    categoryResponse.json(),
    productResponse.json(),
  ]);
  assert.equal(categoryEnvelope.success, true);
  assert.equal(productEnvelope.success, true);
  assert.equal(Array.isArray(categoryEnvelope.data), true);
  assert.equal(Array.isArray(productEnvelope.data?.items), true);
  await page
    .getByText('正在刷新商品目录…')
    .waitFor({ state: 'detached' });
  await page.getByText('商品目录加载失败').waitFor({ state: 'detached' });
  await page.getByText('商品列表', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('商品名称').inputValue(), catalogDraftName);
  await waitForCount(
    page,
    () => categoryRequestCount,
    catalogRequestsAfterFailure.categories + 1,
    'category retry',
  );
  await waitForCount(
    page,
    () => productRequestCount,
    catalogRequestsAfterFailure.products + 1,
    'product retry',
  );
  assert.equal(categoryRequestCount, catalogRequestsAfterFailure.categories + 1);
  assert.equal(productRequestCount, catalogRequestsAfterFailure.products + 1);
  assert.equal(catalogRequestCount, catalogRequestsAfterFailure.total + 2);
  const catalogRequestsAfterRetry = catalogRequestCount;

  const financeRequestsBeforeSelection = financeRequestCount;
  const operationsRequestsBeforeSelection = operationsRequestCount;
  assert.equal(financeRequestsBeforeSelection, 0);
  assert.equal(operationsRequestsBeforeSelection, 0);

  const financeButton = groupedNavigation.getByRole('button', {
    name: '财务对账',
    exact: true,
  });
  await financeButton.click();
  await assertActive(financeButton, '财务对账');
  await page.getByText('订单对账表', { exact: true }).waitFor();
  await waitForCount(page, () => financeRequestCount, 4, 'finance initial load');
  const financeRequestsAfterInitial = financeRequestCount;
  assert.equal(financeRequestsAfterInitial % 4, 0);
  assert.equal(catalogRequestCount, catalogRequestsAfterRetry);
  assert.equal(operationsRequestCount, 0);

  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await waitForCount(
    page,
    () => financeRequestCount,
    financeRequestsAfterInitial + 4,
    'finance active refresh',
  );
  assert.equal(financeRequestCount, financeRequestsAfterInitial + 4);
  assert.equal(catalogRequestCount, catalogRequestsAfterRetry);
  assert.equal(operationsRequestCount, 0);
  assert.equal(await page.getByText('财务对账加载失败').count(), 0);

  const financeRequestsAfterRefresh = financeRequestCount;
  const operationsButton = groupedNavigation.getByRole('button', {
    name: '运营看板',
    exact: true,
  });
  await operationsButton.click();
  await assertActive(operationsButton, '运营看板');
  await page.getByText('近 7 日趋势表', { exact: true }).waitFor();
  await waitForCount(page, () => operationsRequestCount, 6, 'operations initial load');

  const operationsRequestsAfterInitial = operationsRequestCount;
  await page.route('**/api/admin/operations/dashboard/overview', async (route) => {
    if (!operationsFailureInjected) {
      operationsFailureInjected = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          code: 'E2E_OPERATIONS_FAILURE',
          message: '模拟运营看板失败',
        }),
      });
      return;
    }
    await route.continue();
  });

  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await page.getByText('运营看板加载失败', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  assert.equal(operationsFailureInjected, true);
  await waitForCount(
    page,
    () => operationsRequestCount,
    operationsRequestsAfterInitial + 6,
    'operations failed refresh',
  );

  const operationsRequestsAfterFailure = operationsRequestCount;
  await page.getByRole('button', { name: /重\s*试/ }).click();
  await page.getByText('运营看板加载失败').waitFor({ state: 'detached' });
  await page.getByText('近 7 日趋势表', { exact: true }).waitFor();
  await waitForCount(
    page,
    () => operationsRequestCount,
    operationsRequestsAfterFailure + 6,
    'operations retry',
  );
  assert.equal(catalogRequestCount, catalogRequestsAfterRetry);
  assert.equal(financeRequestCount, financeRequestsAfterRefresh);

  assert.deepEqual(readA34RequestCounts(), a34RequestsAfterInitial);
  const withdrawalsButton = groupedNavigation.getByRole('button', {
    name: '提现管理',
    exact: true,
  });
  await withdrawalsButton.click();
  await assertActive(withdrawalsButton, '提现管理');
  await page.getByText('L44 提现人工审核工作台', { exact: true }).waitFor();

  const businessRequestsBeforeWithdrawalRefresh = readBusinessRequestCounts();
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await waitForCount(
    page,
    () => withdrawalRequestCount,
    businessRequestsBeforeWithdrawalRefresh.withdrawals + 1,
    'withdrawal active refresh',
  );
  assert.deepEqual(readBusinessRequestCounts(), {
    ...businessRequestsBeforeWithdrawalRefresh,
    withdrawals: businessRequestsBeforeWithdrawalRefresh.withdrawals + 1,
  });

  const alertsButton = groupedNavigation.getByRole('button', {
    name: '告警中心',
    exact: true,
  });
  await alertsButton.click();
  await assertActive(alertsButton, '告警中心');
  const alertsCardTitle = page
    .locator('.ant-card-head-title')
    .filter({ hasText: /^告警中心$/ });
  await alertsCardTitle.waitFor();

  const alertFailureRoute = async (route) => {
    assert.equal(route.request().method(), 'GET');
    assert.equal(alertFailureInjected, false);
    alertFailureInjected = true;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        code: 'E2E_ALERT_FAILURE',
        message: '模拟运营告警失败',
      }),
    });
  };
  await page.route('**/api/admin/logs/alerts', alertFailureRoute);
  const businessRequestsBeforeAlertFailure = readBusinessRequestCounts();
  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await page.getByText('运营告警加载失败', { exact: true }).waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.getByRole('button', { name: /刷\s*新/ }).waitFor();
  await page.getByRole('button', { name: '退出登录', exact: true }).waitFor();
  assert.equal(alertFailureInjected, true);
  await waitForCount(
    page,
    () => alertRequestCount,
    businessRequestsBeforeAlertFailure.alerts + 1,
    'alert failed refresh',
  );
  assert.deepEqual(readBusinessRequestCounts(), {
    ...businessRequestsBeforeAlertFailure,
    alerts: businessRequestsBeforeAlertFailure.alerts + 1,
  });
  await page.unroute('**/api/admin/logs/alerts', alertFailureRoute);

  const taxReviewButton = groupedNavigation.getByRole('button', {
    name: '税务人工 Review',
    exact: true,
  });
  const businessRequestsDuringAlertError = readBusinessRequestCounts();
  await taxReviewButton.click();
  await assertActive(taxReviewButton, '税务人工 Review');
  await page
    .getByText('税务人工 Review 工作台', { exact: true })
    .waitFor();
  assert.equal(await page.getByText('税务人工 Review 加载失败').count(), 0);
  assert.deepEqual(readBusinessRequestCounts(), businessRequestsDuringAlertError);

  await alertsButton.click();
  await assertActive(alertsButton, '告警中心');
  await page.getByText('运营告警加载失败', { exact: true }).waitFor();
  assert.deepEqual(readBusinessRequestCounts(), businessRequestsDuringAlertError);

  const businessRequestsBeforeAlertRetry = readBusinessRequestCounts();
  const alertRetryResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/admin/logs/alerts' &&
    response.ok(),
  );
  await page.getByRole('button', { name: /重\s*试/ }).click();
  const alertResponse = await alertRetryResponse;
  const alertEnvelope = await alertResponse.json();
  assert.equal(alertEnvelope.success, true);
  assert.equal(Array.isArray(alertEnvelope.data), true);
  await page.getByText('运营告警加载失败').waitFor({ state: 'detached' });
  await alertsCardTitle.waitFor();
  await waitForCount(
    page,
    () => alertRequestCount,
    businessRequestsBeforeAlertRetry.alerts + 1,
    'alert retry',
  );
  assert.deepEqual(readBusinessRequestCounts(), {
    ...businessRequestsBeforeAlertRetry,
    alerts: businessRequestsBeforeAlertRetry.alerts + 1,
  });

  const remainingNavigation = navigation.filter(
    (label) =>
      label !== '商品管理' &&
      label !== '团购管理' &&
      label !== '订单管理' &&
      label !== '售后客服' &&
      label !== '库存管理' &&
      label !== '采购计划' &&
      label !== '批次库存' &&
      label !== '财务对账' &&
      label !== '运营看板' &&
      label !== '提现管理' &&
      label !== '告警中心' &&
      label !== '税务人工 Review',
  );
  for (const label of remainingNavigation) {
    const button = groupedNavigation.getByRole('button', { name: label, exact: true });
    await button.click();
    await assertActive(button, label);
    await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  }
  assert.equal(await buttons.count(), navigation.length);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText(`当前管理员：${credentials.username}`).waitFor();
  await groupedNavigation.getByRole('button', { name: '商品管理', exact: true }).waitFor();

  await page.evaluate(() => { window.__ADMIN_E2E_FORCE_RENDER_ERROR__ = true; });
  await groupedNavigation.getByRole('button', { name: '订单管理', exact: true }).click();
  await page.getByText('当前页面加载失败').waitFor();
  await page.getByRole('heading', { name: '社区甄选管理后台' }).waitFor();
  await page.evaluate(() => { window.__ADMIN_E2E_FORCE_RENDER_ERROR__ = false; });
  await groupedNavigation.getByRole('button', { name: '商品管理', exact: true }).click();
  await page.getByText('当前页面加载失败').waitFor({ state: 'detached' });

  await shell.getByRole('button', { name: /刷\s*新/ }).click();
  await shell.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByText('后台登录', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('后台登录', { exact: true }).waitFor();

  console.log(
    `L50 Admin browser smoke passed: ${navigation.length}/${navigation.length} navigation items; catalog requests=${catalogRequestCount}; finance requests=${financeRequestCount}; operations requests=${operationsRequestCount}; inventory requests=${inventoryOverviewRequestCount}; purchase-plan requests=${purchasePlanRequestCount}; suppliers requests=${supplierRequestCount}; batches requests=${batchRequestCount}; expiry-alert requests=${expiryAlertRequestCount}; stock-check requests=${stockCheckRequestCount}; withdrawal requests=${withdrawalRequestCount}; alert requests=${alertRequestCount}; tax-review requests=${taxReviewRequestCount}.`,
  );
} finally {
  await context.close();
  await browser.close();
}
