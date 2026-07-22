'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('business flow controls expose stable click selectors', () => {
  const selectors = {
    'apps/miniapp/pages/products/index.wxml': [
      'product-normal-buy',
    ],
    'apps/miniapp/pages/orders/confirm/index.wxml': [
      'fulfillment-store',
      'fulfillment-delivery',
      'delivery-window',
      'receiver-name',
      'receiver-phone',
      'receiver-address',
      'checkout-submit',
    ],
    'apps/miniapp/pages/orders/detail/index.wxml': [
      'after-sale-apply',
    ],
    'apps/miniapp/pages/after-sales/apply/index.wxml': [
      'after-sale-reason',
      'after-sale-submit',
    ],
    'apps/miniapp/pages/start-group-buy/index.wxml': [
      'group-create-submit',
    ],
    'apps/miniapp/pages/group-buy-detail/index.wxml': [
      'group-join',
    ],
    'apps/miniapp/pages/join-order/index.wxml': [
      'group-order-name',
      'group-order-phone',
      'group-order-submit',
    ],
  };

  for (const [relativePath, testIds] of Object.entries(selectors)) {
    const source = read(relativePath);
    for (const testId of testIds) {
      assert.match(source, new RegExp(`data-testid=["']${testId}["']`), `${relativePath} must expose ${testId}`);
    }
  }
  assert.match(
    read('apps/miniapp/pages/products/index.wxml'),
    /id=["']product-normal-buy-\{\{item\.product_id\}\}["']/,
    'product buy action must expose a deterministic id selector',
  );
});

test('group participant identity comes from the active Mini Program user', () => {
  const source = read('apps/miniapp/pages/join-order/index.js');
  assert.match(source, /require\(['"]\.\.\/\.\.\/utils\/user['"]\)/);
  assert.match(source, /require\(['"]\.\.\/\.\.\/utils\/selection['"]\)/);
  assert.match(source, /const user = getCurrentUser\(\)/);
  assert.match(source, /user_openid:\s*user\.openid/);
  assert.match(source, /pickup_store_id:\s*this\.data\.pickup_store_id/);
  assert.match(source, /community_id:\s*this\.data\.community_id/);
  assert.match(source, /pickup_type:\s*['"]store['"]/);
  assert.doesNotMatch(source, /user_openid:\s*['"]customer-openid['"]/);
  assert.match(source, /paymentResponse\.data\.success/);
  assert.doesNotMatch(source, /complete:\s*\(\)\s*=>\s*wx\.navigateTo/);
});

test('group leader identity comes from the active Mini Program user', () => {
  const source = read('apps/miniapp/pages/start-group-buy/index.js');
  assert.match(source, /require\(['"]\.\.\/\.\.\/utils\/user['"]\)/);
  assert.match(source, /const user = getCurrentUser\(\)/);
  assert.match(source, /leader_openid:\s*user\.openid/);
  assert.doesNotMatch(source, /leader_openid:\s*['"]leader-openid['"]/);
});

test('business flow helper unwraps API envelopes and preserves failure messages', async () => {
  const { apiRequest } = require('./business-flow-lib.cjs');
  const successFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { id: 'order-1' }, message: '' }),
  });
  assert.deepEqual(
    await apiRequest('http://127.0.0.1:13080', '/api/orders/order-1', {}, successFetch),
    { id: 'order-1' },
  );

  const failureFetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ success: false, data: null, message: '状态不允许' }),
  });
  await assert.rejects(
    () => apiRequest('http://127.0.0.1:13080', '/api/orders/order-1/status', {}, failureFetch),
    /状态不允许/,
  );
});

test('business product entry filters the list and uses one deterministic id selector', async () => {
  const { openProductAndFindBuyAction } = require('./business-flow.cjs');
  const calls = [];
  const buyAction = { tap() {} };
  const page = {
    path: 'pages/products/index',
    data() {
      throw new Error('full Page.getData must not be used for product readiness');
    },
    async $(selector) {
      calls.push(['selector', selector]);
      return selector === '#product-normal-buy-product-1' ? buyAction : null;
    },
  };
  const miniProgram = {
    async reLaunch(route) {
      calls.push(['route', route]);
      return page;
    },
  };

  const result = await openProductAndFindBuyAction(
    miniProgram,
    { product_id: 'product-1', name: '有机 青菜' },
  );

  assert.equal(result.page, page);
  assert.equal(result.buyAction, buyAction);
  assert.deepEqual(calls, [
    ['route', '/pages/products/index?keyword=%E6%9C%89%E6%9C%BA%20%E9%9D%92%E8%8F%9C'],
    ['selector', '#product-normal-buy-product-1'],
  ]);
});

test('business automator operation timeout rejects a stalled protocol request', async () => {
  const { withOperationTimeout } = require('./business-flow.cjs');
  await assert.rejects(
    () => withOperationTimeout(() => new Promise(() => {}), 'read product page data', 10),
    /Timed out after 10 ms during read product page data/,
  );
});

test('business progress reporter flushes visible step events immediately', () => {
  const { createProgressReporter } = require('./business-flow.cjs');
  const output = [];
  const progress = createProgressReporter((line) => output.push(line));

  progress('ordinary-store-start', { productId: 'product-1' });

  assert.deepEqual(output, [
    '[business-e2e] ordinary-store-start {"productId":"product-1"}\n',
  ]);
});

test('business failure evidence cannot hang on a stalled Page.getData request', async () => {
  const { captureFailureEvidence } = require('./business-flow.cjs');
  const events = [];
  const miniProgram = {
    async currentPage() {
      return {
        path: 'pages/products/index',
        data: () => new Promise(() => {}),
      };
    },
    async screenshot() {
      throw new Error('screenshot must not run after data capture timed out');
    },
  };

  await captureFailureEvidence(
    miniProgram,
    (event, details) => events.push({ event, details }),
    { screenshot: '/tmp/business-failure.png' },
    10,
  );

  assert.equal(events[0].event, 'failure-evidence-error');
  assert.match(events[0].details.message, /Timed out after 10 ms during read failure page data/);
});

test('business close fallback disconnects a stalled automator socket', async () => {
  const { closeMiniProgramSafely } = require('./business-flow.cjs');
  let disconnected = false;
  const miniProgram = {
    close: () => new Promise(() => {}),
    disconnect() {
      disconnected = true;
    },
  };

  await assert.rejects(
    () => closeMiniProgramSafely(miniProgram, 10),
    /Timed out after 10 ms during close Mini Program automation/,
  );
  assert.equal(disconnected, true);
});

test('business flow helper normalizes fixtures for Mini Program storage', () => {
  const { normalizeCommunity, normalizePickupStore, selectBusinessFixtures } = require('./business-flow-lib.cjs');
  assert.deepEqual(normalizeCommunity({ id: 'community-1', name: '幸福里' }), {
    id: 'community-1',
    community_id: 'community-1',
    name: '幸福里',
  });
  assert.deepEqual(normalizePickupStore({ id: 'store-1', name: '自提点', address: '中心街', phone: '123' }), {
    id: 'store-1',
    pickup_store_id: 'store-1',
    name: '自提点',
    address: '中心街',
    phone: '123',
  });
  assert.deepEqual(
    selectBusinessFixtures(
      { items: [{ product_id: 'product-1', stock: 4, status: 'active', is_group_enabled: true }] },
      [{ id: 'community-1', name: '幸福里' }],
      [{ id: 'store-1', name: '自提点' }],
    ).product.product_id,
    'product-1',
  );
  const paired = selectBusinessFixtures(
    { items: [{ product_id: 'product-1', stock: 4, status: 'active', is_group_enabled: true }] },
    [{ id: 'community-1', name: '幸福里' }, { id: 'community-2', name: '锦绣里' }],
    [{ id: 'store-2', community_id: 'community-2', name: '锦绣自提点' }],
  );
  assert.equal(paired.community.community_id, 'community-2');
  assert.equal(paired.pickupStore.pickup_store_id, 'store-2');
});

test('business flow helper locks the two fulfillment state sequences', () => {
  const {
    DELIVERY_SEQUENCE,
    STORE_SEQUENCE,
    assertGroupSucceeded,
    assertOrderState,
  } = require('./business-flow-lib.cjs');
  assert.deepEqual(STORE_SEQUENCE, ['preparing', 'ready', 'picked', 'completed']);
  assert.deepEqual(DELIVERY_SEQUENCE, ['preparing', 'ready', 'delivered', 'completed']);
  assert.doesNotThrow(() => assertOrderState({ pay_status: 'paid', order_status: 'ready' }, { pay_status: 'paid', order_status: 'ready' }));
  assert.throws(() => assertOrderState({ pay_status: 'paid', order_status: 'paid' }, { order_status: 'ready' }), /expected order_status=ready/);
  assert.doesNotThrow(() => assertGroupSucceeded({ status: 'success', paid_quantity: 2, target_count: 2 }));
  assert.throws(() => assertGroupSucceeded({ status: 'pending', paid_quantity: 1, target_count: 2 }), /expected group status=success/);
});

test('store pickup fulfillment uses the real pickup verification endpoint', async () => {
  const { advanceOrder } = require('./business-flow-lib.cjs');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body, headers: options.headers || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: options.method === 'POST'
          ? { id: 'order-1', pay_status: 'paid', order_status: 'picked' }
          : { id: 'order-1', pay_status: 'paid', order_status: 'picked' },
        message: '',
      }),
    };
  };
  await advanceOrder('http://127.0.0.1:13080', 'order-1', ['picked'], 'buyer-openid', () => {}, fetchImpl);
  assert.equal(calls[0].url, 'http://127.0.0.1:13080/api/admin/orders/order-1/pickup-verify');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[1].url, 'http://127.0.0.1:13080/api/me/orders/order-1');
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[1].headers['x-openid'], 'buyer-openid');
});

test('cleanup ignores unknown test users created after the last successful API step', async () => {
  const { discoverUserOrders } = require('./business-flow-lib.cjs');
  const missingUserFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({
      success: false,
      data: null,
      message: '用户不存在',
    }),
  });
  assert.deepEqual(
    await discoverUserOrders(
      'http://127.0.0.1:13080',
      [],
      ['never-created'],
      missingUserFetch,
    ),
    [],
  );

  const serverFailureFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({
      success: false,
      data: null,
      message: '数据库失败',
    }),
  });
  await assert.rejects(
    () => discoverUserOrders(
      'http://127.0.0.1:13080',
      [],
      ['broken-user'],
      serverFailureFetch,
    ),
    /数据库失败/,
  );
});

test('cleanup discovers paid orders even when post-payment page navigation failed', async () => {
  const { discoverUserOrders } = require('./business-flow-lib.cjs');
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, headers: options.headers || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { items: [{ id: 'order-after-navigation-failure', pay_status: 'paid' }] },
        message: '',
      }),
    };
  };
  const references = await discoverUserOrders(
    'http://127.0.0.1:13080',
    [{ id: 'known-order', openid: 'buyer-openid' }],
    ['buyer-openid'],
    fetchImpl,
  );
  assert.deepEqual(references, [
    { id: 'known-order', openid: 'buyer-openid' },
    { id: 'order-after-navigation-failure', openid: 'buyer-openid' },
  ]);
  assert.equal(calls[0].url, 'http://127.0.0.1:13080/api/me/orders?page_size=100');
  assert.equal(calls[0].headers['x-openid'], 'buyer-openid');
});

test('group pages honor the temporary Mini Program API base override', () => {
  for (const relativePath of [
    'apps/miniapp/pages/start-group-buy/index.js',
    'apps/miniapp/pages/group-buy-detail/index.js',
    'apps/miniapp/pages/join-order/index.js',
  ]) {
    const source = read(relativePath);
    assert.match(source, /getApiBaseUrl/);
    assert.doesNotMatch(source, /const\s*\{\s*apiBaseUrl\s*\}\s*=\s*require\(['"]\.\.\/\.\.\/config['"]\)/);
  }
});

test('business click runner covers ordinary pickup, delivery, after-sale refund and two-user group success', () => {
  const runnerPath = path.join(root, 'scripts/miniapp-e2e/business-flow.cjs');
  assert.equal(fs.existsSync(runnerPath), true, 'business-flow.cjs must exist');
  const source = fs.readFileSync(runnerPath, 'utf8');
  for (const marker of [
    'runOrdinaryPurchaseFlow',
    'runGroupBuyFlow',
    'findProductBuyAction',
    "callMethod('onProductChange'",
    "callMethod('onCommunityChange'",
    'fulfillment-store',
    'fulfillment-delivery',
    'after-sale-submit',
    'createFullMockRefund',
    'group-create-submit',
    'group-join',
    'miniapp-business-group-a-',
    'miniapp-business-group-b-',
    'assertGroupSucceeded',
    'STORE_SEQUENCE',
    'DELIVERY_SEQUENCE',
    '/api/pickup-stores?community_id=',
    'captureBusinessStorage',
    'restoreBusinessStorage',
    'cleanupBusinessOrders',
    'MINIAPP_E2E_KEEP_DATA',
  ]) {
    assert.equal(source.includes(marker), true, `business runner must contain ${marker}`);
  }
});

test('package and container runner expose the business click suite', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(
    packageJson.scripts['e2e:miniapp:business'],
    'node scripts/miniapp-e2e/container-runner.cjs --suite business',
  );
  const runner = read('scripts/miniapp-e2e/container-runner.cjs');
  assert.match(runner, /MINIAPP_E2E_REAL:\s*['"]1['"]/);
  assert.match(runner, /require\.resolve\(['"]vitest\/vitest\.mjs['"]\)/);
  assert.match(runner, /tests\/miniapp-e2e\/vitest\.config\.ts/);
  assert.doesNotMatch(runner, /business:\s*['"]business-flow\.cjs['"]/);
});

