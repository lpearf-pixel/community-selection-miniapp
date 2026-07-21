'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { launchDevTools } = require('./devtools-launcher.cjs');
const {
  artifactPaths,
  assertMiniappProjectConfigured,
  assertPagePath,
  overrideMiniappApiBaseUrl,
  resolveE2eConfig,
  resolveMiniappApiBaseUrl,
  restoreMiniappApiBaseUrl,
} = require('./lib.cjs');
const {
  DELIVERY_SEQUENCE,
  STORE_SEQUENCE,
  advanceOrder,
  apiRequest,
  assertGroupSucceeded,
  assertOrderState,
  createFullMockRefund,
  discoverUserOrders,
  getUserOrder,
  makeRunId,
  selectBusinessFixtures,
  waitUntil,
} = require('./business-flow-lib.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ serializationError: error.message });
  }
}

async function waitForPagePath(miniProgram, expected, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let current;
  while (Date.now() < deadline) {
    current = await miniProgram.currentPage();
    if (current && String(current.path || '').replace(/^\/+/, '') === String(expected).replace(/^\/+/, '')) return current;
    await delay(250);
  }
  assertPagePath(current && current.path, expected);
}

async function waitForPageData(page, predicate, description, timeout = 20000) {
  return waitUntil(
    () => page.data(),
    predicate,
    description,
    { timeout, interval: 250 },
  );
}

async function findByTestId(page, testId, timeout = 15000) {
  const selector = `[data-testid="${testId}"]`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const element = await page.$(selector);
    if (element) return element;
    await delay(250);
  }
  throw new Error(`Missing Mini Program element ${selector} on ${page.path}`);
}

async function findByTestIdAndDataId(page, testId, dataId, timeout = 15000) {
  const selector = `[data-testid="${testId}"][data-id="${dataId}"]`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const element = await page.$(selector);
    if (element) return element;
    await delay(250);
  }
  throw new Error(`Missing Mini Program element ${selector} on ${page.path}`);
}

const BUSINESS_STORAGE_KEYS = Object.freeze([
  'community_selection_user',
  'selected_community',
  'selected_pickup_store',
]);

async function captureBusinessStorage(miniProgram) {
  const snapshot = {};
  for (const key of BUSINESS_STORAGE_KEYS) {
    snapshot[key] = await miniProgram.callWxMethod('getStorageSync', key);
  }
  return snapshot;
}

async function restoreBusinessStorage(miniProgram, snapshot) {
  for (const key of BUSINESS_STORAGE_KEYS) {
    const value = snapshot && snapshot[key];
    if (value === undefined || value === null || value === '') {
      await miniProgram.callWxMethod('removeStorageSync', key);
    } else {
      await miniProgram.callWxMethod('setStorageSync', key, value);
    }
  }
}

async function setBusinessUser(miniProgram, openid, nickname, phone) {
  const user = {
    user_id: '',
    openid,
    nickname,
    receiver_name: nickname,
    receiver_phone: phone,
  };
  await miniProgram.callWxMethod('setStorageSync', 'community_selection_user', user);
  return user;
}

async function setBusinessLocation(miniProgram, fixtures) {
  await miniProgram.callWxMethod('setStorageSync', 'selected_community', fixtures.community);
  await miniProgram.callWxMethod('setStorageSync', 'selected_pickup_store', fixtures.pickupStore);
}

async function loadFixtures(apiBaseUrl) {
  const [products, communitiesPayload] = await Promise.all([
    apiRequest(apiBaseUrl, '/api/products?page_size=100&only_group_enabled=true&only_in_stock=true'),
    apiRequest(apiBaseUrl, '/api/communities'),
  ]);
  const communities = Array.isArray(communitiesPayload)
    ? communitiesPayload
    : (communitiesPayload && communitiesPayload.items) || [];
  for (const community of communities) {
    const communityId = community.community_id || community.id;
    const pickupStores = await apiRequest(
      apiBaseUrl,
      `/api/pickup-stores?community_id=${encodeURIComponent(communityId)}&page_size=100`,
    );
    const stores = Array.isArray(pickupStores) ? pickupStores : (pickupStores && pickupStores.items) || [];
    if (stores.length) return selectBusinessFixtures(products, [community], stores);
  }
  throw new Error('No active community with an active pickup-store fixture');
}

async function waitForOrderDetail(miniProgram) {
  const page = await waitForPagePath(miniProgram, 'pages/orders/detail/index');
  const data = await waitForPageData(
    page,
    (value) => !value.loading && value.order && value.order.id,
    'paid order detail',
  );
  return { page, order: data.order };
}

async function createOrdinaryOrder(context, fulfillment) {
  const { miniProgram, runId, record } = context;
  const suffix = fulfillment === 'delivery' ? 'delivery' : 'store';
  const openid = `miniapp-business-normal-${suffix}-${runId}`;
  context.testOpenids.add(openid);
  await setBusinessUser(miniProgram, openid, `普通购买${suffix}`, suffix === 'delivery' ? '13800001002' : '13800001001');
  await setBusinessLocation(miniProgram, context.fixtures);

  let page = await miniProgram.reLaunch('/pages/products/index');
  await waitForPageData(page, (data) => !data.loading && Array.isArray(data.products) && data.products.length > 0, `${suffix} product list`);
  await (await findByTestIdAndDataId(
    page,
    'product-normal-buy',
    context.fixtures.product.product_id,
  )).tap();
  page = await waitForPagePath(miniProgram, 'pages/orders/confirm/index');
  await waitForPageData(
    page,
    (data) => !data.loading && data.product && data.pickup_store_id,
    `${suffix} checkout fixture`,
  );

  if (fulfillment === 'delivery') {
    await (await findByTestId(page, 'fulfillment-delivery')).tap();
    await waitForPageData(
      page,
      (data) => data.pickup_type === 'delivery' && Array.isArray(data.delivery_time_windows) && data.delivery_time_windows.length > 0,
      'delivery options',
    );
    await (await findByTestId(page, 'delivery-window')).tap();
    await (await findByTestId(page, 'receiver-name')).input('配送测试用户');
    await (await findByTestId(page, 'receiver-phone')).input('13800001002');
    await (await findByTestId(page, 'receiver-address')).input('测试路 18 号');
    await waitForPageData(
      page,
      (data) => data.delivery_time_window_code && data.receiver_address === '测试路 18 号',
      'delivery form inputs',
    );
  } else {
    await (await findByTestId(page, 'fulfillment-store')).tap();
  }

  await (await findByTestId(page, 'checkout-submit')).tap();
  const detail = await waitForOrderDetail(miniProgram);
  assertOrderState(detail.order, { pay_status: 'paid', pickup_type: fulfillment });
  context.createdOrders.push({ id: detail.order.id, openid });
  record('ordinary-order-paid', { fulfillment, orderId: detail.order.id });
  const sequence = fulfillment === 'delivery' ? DELIVERY_SEQUENCE : STORE_SEQUENCE;
  const completed = await advanceOrder(context.apiBaseUrl, detail.order.id, sequence, openid, record);
  await detail.page.callMethod('retryOrder');
  await waitForPageData(
    detail.page,
    (data) => data.order && data.order.order_status === 'completed',
    `${suffix} completed order detail`,
  );
  return { order: completed, page: detail.page, openid };
}

async function runOrdinaryPurchaseFlow(context) {
  const storeResult = await createOrdinaryOrder(context, 'store');
  await createOrdinaryOrder(context, 'delivery');

  await setBusinessUser(context.miniProgram, storeResult.openid, '普通购买store', '13800001001');
  let page = await context.miniProgram.reLaunch(`/pages/orders/detail/index?id=${storeResult.order.id}`);
  await waitForPageData(
    page,
    (data) => !data.loading && data.order && data.order.can_apply_after_sale,
    'completed order after-sale action',
  );
  await (await findByTestId(page, 'after-sale-apply')).tap();
  page = await waitForPagePath(context.miniProgram, 'pages/after-sales/apply/index');
  await waitForPageData(page, (data) => !data.loading && data.can_submit, 'after-sale refundable amount');
  await (await findByTestId(page, 'after-sale-reason')).input('点击闭环测试售后');
  await (await findByTestId(page, 'after-sale-submit')).tap();
  page = await waitForPagePath(context.miniProgram, 'pages/after-sales/detail/index');
  const afterSaleData = await waitForPageData(
    page,
    (data) => !data.loading && Array.isArray(data.items) && data.items.length > 0,
    'submitted after-sale case',
  );
  context.record('after-sale-submitted', { orderId: storeResult.order.id, caseId: afterSaleData.items[0].id });

  const refundableOrder = await getUserOrder(context.apiBaseUrl, storeResult.order.id, storeResult.openid);
  await createFullMockRefund(context.apiBaseUrl, refundableOrder, context.runId);
  const refundedOrder = await getUserOrder(context.apiBaseUrl, storeResult.order.id, storeResult.openid);
  assertOrderState(refundedOrder, { pay_status: 'paid', order_status: 'refunded', refund_status: 'success' });
  context.record('ordinary-after-sale-refunded', { orderId: refundedOrder.id, refundAmount: refundedOrder.refund_amount_cents });
  return { storeOrder: refundedOrder };
}

async function createPaidGroupParticipant(context, groupBuyId, participant, usedOrderIds) {
  context.testOpenids.add(participant.openid);
  await setBusinessUser(context.miniProgram, participant.openid, participant.name, participant.phone);
  await setBusinessLocation(context.miniProgram, context.fixtures);
  let page = await context.miniProgram.reLaunch(`/pages/group-buy-detail/index?id=${groupBuyId}`);
  await waitForPageData(page, (data) => !data.loading && data.groupBuy && data.groupBuy.can_join, `${participant.name} joinable group`);
  await (await findByTestId(page, 'group-join')).tap();
  page = await waitForPagePath(context.miniProgram, 'pages/join-order/index');
  await (await findByTestId(page, 'group-order-name')).input(participant.name);
  await (await findByTestId(page, 'group-order-phone')).input(participant.phone);
  await (await findByTestId(page, 'group-order-submit')).tap();
  page = await waitForPagePath(context.miniProgram, 'pages/orders/index');
  const data = await waitForPageData(
    page,
    (value) => !value.loading && Array.isArray(value.orders) && value.orders.some((order) => order.group_buy_id === groupBuyId && order.pay_status === 'paid' && !usedOrderIds.has(order.id)),
    `${participant.name} paid group order`,
  );
  const order = data.orders.find((item) => item.group_buy_id === groupBuyId && item.pay_status === 'paid' && !usedOrderIds.has(item.id));
  usedOrderIds.add(order.id);
  context.createdOrders.push({ id: order.id, openid: participant.openid });
  context.record('group-participant-paid', { groupBuyId, orderId: order.id, openid: participant.openid });
  return { ...order, participantOpenid: participant.openid };
}

async function runGroupBuyFlow(context) {
  await setBusinessUser(context.miniProgram, 'leader-openid', '测试开团人', '13800000001');
  await setBusinessLocation(context.miniProgram, context.fixtures);
  let page = await context.miniProgram.reLaunch('/pages/start-group-buy/index');
  const optionData = await waitForPageData(
    page,
    (data) => !data.loading && Array.isArray(data.products) && data.products.length > 0 && Array.isArray(data.communities) && data.communities.length > 0,
    'group creation fixtures',
  );
  const productIndex = optionData.products.findIndex(
    (product) => (product.product_id || product.id) === context.fixtures.product.product_id,
  );
  const communityIndex = optionData.communities.findIndex(
    (community) => (community.community_id || community.id) === context.fixtures.community.community_id,
  );
  if (productIndex < 0) throw new Error(`Group product fixture ${context.fixtures.product.product_id} is not selectable`);
  if (communityIndex < 0) throw new Error(`Group community fixture ${context.fixtures.community.community_id} is not selectable`);
  await page.callMethod('onProductChange', { detail: { value: String(productIndex) } });
  await page.callMethod('onCommunityChange', { detail: { value: String(communityIndex) } });
  await (await findByTestId(page, 'group-create-submit')).tap();
  page = await waitForPagePath(context.miniProgram, 'pages/group-buy-detail/index');
  const groupData = await waitForPageData(page, (data) => !data.loading && data.groupBuy && data.groupBuy.group_buy_id, 'created group detail');
  const groupBuyId = groupData.groupBuy.group_buy_id;
  context.record('group-created', { groupBuyId, target: groupData.groupBuy.target_count });

  const participants = [
    { openid: `miniapp-business-group-a-${context.runId}`, name: '参团用户A', phone: '13800002001' },
    { openid: `miniapp-business-group-b-${context.runId}`, name: '参团用户B', phone: '13800002002' },
  ];
  const usedOrderIds = new Set();
  const orders = [];
  for (const participant of participants) {
    orders.push(await createPaidGroupParticipant(context, groupBuyId, participant, usedOrderIds));
  }

  const succeeded = await waitUntil(
    () => apiRequest(context.apiBaseUrl, `/api/group-buys/${encodeURIComponent(groupBuyId)}`),
    (groupBuy) => groupBuy.status === 'success',
    'group-buy success after two paid participants',
  );
  assertGroupSucceeded(succeeded);
  context.record('group-succeeded', { groupBuyId, paidQuantity: succeeded.paid_quantity, target: succeeded.target_count });
  for (const order of orders) {
    await advanceOrder(context.apiBaseUrl, order.id, STORE_SEQUENCE, order.participantOpenid, context.record);
  }
  assertGroupSucceeded(await apiRequest(context.apiBaseUrl, `/api/group-buys/${encodeURIComponent(groupBuyId)}`));
  context.record('group-fulfilled', { groupBuyId, orderIds: orders.map((order) => order.id) });
  return { groupBuyId, orders };
}

async function cleanupBusinessOrders(context) {
  if (!context || !context.createdOrders || process.env.MINIAPP_E2E_KEEP_DATA === 'true') {
    if (context) context.record('cleanup-skipped', { reason: 'MINIAPP_E2E_KEEP_DATA' });
    return;
  }
  const failures = [];
  let references;
  try {
    references = await discoverUserOrders(
      context.apiBaseUrl,
      context.createdOrders,
      [...context.testOpenids],
    );
  } catch (error) {
    throw new Error(`Business fixture discovery failed: ${error.message}`);
  }
  for (const reference of references) {
    try {
      const order = await getUserOrder(context.apiBaseUrl, reference.id, reference.openid);
      const refundable = Number(order.pay_amount_cents || 0) - Number(order.refund_amount_cents || 0);
      if (order.pay_status === 'paid' && refundable > 0 && order.order_status !== 'closed') {
        await createFullMockRefund(context.apiBaseUrl, order, `${context.runId}-cleanup`);
        const cleaned = await getUserOrder(context.apiBaseUrl, reference.id, reference.openid);
        assertOrderState(cleaned, { order_status: 'refunded', refund_status: 'success' });
        context.record('cleanup-order-refunded', { orderId: reference.id });
      }
    } catch (error) {
      failures.push(`${reference.id}: ${error.message}`);
      context.record('cleanup-order-error', { orderId: reference.id, message: error.message });
    }
  }
  if (failures.length) throw new Error(`Business fixture cleanup failed: ${failures.join('; ')}`);
}

async function main() {
  const config = resolveE2eConfig();
  const apiBaseUrl = resolveMiniappApiBaseUrl();
  const artifacts = artifactPaths(process.env.MINIAPP_E2E_OUTPUT_DIR || '/tmp');
  const runId = makeRunId();
  const logs = [];
  const exceptions = [];
  let miniProgram;
  let previousApiBaseUrl;
  let previousBusinessStorage;
  let apiBaseOverrideApplied = false;
  let businessStorageCaptured = false;
  let context;
  const record = (event, details = {}) => logs.push(`${new Date().toISOString()} ${event} ${safeJson(details)}`);

  fs.mkdirSync(path.dirname(artifacts.log), { recursive: true });
  try {
    if (!fs.existsSync(config.cliPath)) throw new Error(`WeChat DevTools CLI not found: ${config.cliPath}`);
    if (!fs.existsSync(config.projectPath)) throw new Error(`Mini Program project not found: ${config.projectPath}`);
    assertMiniappProjectConfigured(config.projectPath);
    const launched = await launchDevTools(config);
    miniProgram = launched.miniProgram;
    miniProgram.on('console', (event) => record('console', event));
    miniProgram.on('exception', (event) => {
      exceptions.push(event);
      record('exception', event);
    });
    previousBusinessStorage = await captureBusinessStorage(miniProgram);
    businessStorageCaptured = true;
    previousApiBaseUrl = await overrideMiniappApiBaseUrl(miniProgram, apiBaseUrl);
    apiBaseOverrideApplied = true;
    const fixtures = await loadFixtures(apiBaseUrl);
    record('fixtures-ready', { productId: fixtures.product.product_id, communityId: fixtures.community.community_id, pickupStoreId: fixtures.pickupStore.pickup_store_id });
    context = { apiBaseUrl, createdOrders: [], fixtures, miniProgram, record, runId, testOpenids: new Set() };
    await runOrdinaryPurchaseFlow(context);
    process.stdout.write('ordinary_purchase_flow=passed\n');
    await runGroupBuyFlow(context);
    process.stdout.write('group_buy_flow=passed\n');
    if (exceptions.length) throw new Error(`Mini Program emitted ${exceptions.length} uncaught exception(s)`);
    record('passed', { runId });
    process.stdout.write(`Mini Program business flow log: ${artifacts.log}\n`);
  } catch (error) {
    record('failed', { message: error.message, stack: error.stack });
    if (miniProgram) {
      try {
        const current = await miniProgram.currentPage();
        record('failure-page', { path: current && current.path, data: current ? await current.data() : null });
        await miniProgram.screenshot({ path: artifacts.screenshot });
        record('failure-screenshot', { path: artifacts.screenshot });
      } catch (evidenceError) {
        record('failure-evidence-error', { message: evidenceError.message });
      }
    }
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (miniProgram) {
      if (context) {
        try {
          await cleanupBusinessOrders(context);
        } catch (error) {
          record('business-cleanup-error', { message: error.message });
          process.stderr.write(`${error.stack || error.message}\n`);
          process.exitCode = 1;
        }
      }
      if (businessStorageCaptured) {
        try {
          await restoreBusinessStorage(miniProgram, previousBusinessStorage);
        } catch (error) {
          record('business-storage-restore-error', { message: error.message });
          process.exitCode = 1;
        }
      }
      if (apiBaseOverrideApplied) {
        try {
          await restoreMiniappApiBaseUrl(miniProgram, previousApiBaseUrl);
        } catch (error) {
          record('api-base-restore-error', { message: error.message });
          process.exitCode = 1;
        }
      }
      try {
        await miniProgram.close();
      } catch (error) {
        record('close-error', { message: error.message });
        process.exitCode = 1;
      }
    }
    fs.writeFileSync(artifacts.log, `${logs.join('\n')}\n`, 'utf8');
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runGroupBuyFlow, runOrdinaryPurchaseFlow };
