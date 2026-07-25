const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..', '..');

function requireSourceMatch(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, label);
  return match;
}

function sourceRange(source, startPattern, endPattern, label) {
  const startMatch = requireSourceMatch(
    source,
    startPattern,
    `${label}: start`,
  );
  const markerIndex = source.indexOf(startMatch[0]);
  const start = markerIndex + startMatch[0].length;
  const tail = source.slice(start);
  const endMatch = requireSourceMatch(tail, endPattern, `${label}: end`);
  const end = start + endMatch.index;
  return {
    start,
    end,
    source: source.slice(start, end),
  };
}

function sourceBetween(source, startPattern, endPattern, label) {
  return sourceRange(source, startPattern, endPattern, label).source;
}

function assertSourceOrder(source, steps, label) {
  let offset = 0;
  for (const [stepLabel, pattern] of steps) {
    const tail = source.slice(offset);
    const match = tail.match(pattern);
    assert.ok(match, `${label}: ${stepLabel}`);
    offset += match.index + match[0].length;
  }
}

function registeredRoutes(source) {
  const sourceFile = ts.createSourceFile(
    'admin-smoke.mjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const registrations = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.expression.text === 'page' ||
        node.expression.expression.text === 'context' ||
        node.expression.expression.text === 'pickupConflictPage') &&
      node.expression.name.text === 'route'
    ) {
      const [target, handler] = node.arguments;
      registrations.push({
        receiver: node.expression.expression.text,
        target:
          target && ts.isStringLiteralLike(target)
            ? { kind: 'string', value: target.text }
            : { kind: 'expression', value: target?.getText(sourceFile) ?? '' },
        handler: handler?.getText(sourceFile) ?? '',
        call: node.getText(sourceFile),
        start: node.getStart(sourceFile),
        end: node.end,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return registrations;
}

function assertA32SmokeContract(smoke) {
  assertSourceOrder(
    smoke,
    [
      [
        'group-buy exact primary counter',
        /if \(pathname === '\/api\/group-buys'\) \{\s*groupBuyRequestCount \+= 1;\s*\}/,
      ],
      [
        'orders exact primary counter',
        /if \(pathname === '\/api\/admin\/orders'\) \{\s*orderRequestCount \+= 1;\s*\}/,
      ],
      [
        'fulfillment exact primary counter',
        /if \(pathname === '\/api\/admin\/fulfillment\/overview'\) \{\s*fulfillmentRequestCount \+= 1;\s*\}/,
      ],
      [
        'after-sales exact primary counter',
        /if \(pathname === '\/api\/admin\/after-sales'\) \{\s*afterSalesRequestCount \+= 1;\s*\}/,
      ],
    ],
    'exact A3.2 primary request routing',
  );

  const initialMounts = sourceBetween(
    smoke,
    /await page\.getByText\(`当前管理员：\$\{credentials\.username\}`\)\.waitFor\(\);/,
    /const shell = page\.getByRole/,
    'hidden-mount settlement and initial baseline',
  );
  assertSourceOrder(
    initialMounts,
    [
      [
        'group-buy hidden mount started',
        /await waitForCount\(page, \(\) => groupBuyRequestCount, 1, 'group-buy initial load'\);/,
      ],
      [
        'orders hidden mount started',
        /await waitForCount\(page, \(\) => orderRequestCount, 1, 'order initial load'\);/,
      ],
      [
        'fulfillment hidden mount started',
        /await waitForCount\(page, \(\) => fulfillmentRequestCount, 1, 'fulfillment initial load'\);/,
      ],
      [
        'after-sales hidden mount started',
        /await waitForCount\(page, \(\) => afterSalesRequestCount, 1, 'after-sales initial load'\);/,
      ],
      [
        'hidden mounts settled',
        /await page\.waitForLoadState\('networkidle'\);/,
      ],
      [
        'relative counter reader',
        /const readA32RequestCounts = \(\) => \(\{\s*groupBuys: groupBuyRequestCount,\s*orders: orderRequestCount,\s*fulfillment: fulfillmentRequestCount,\s*afterSales: afterSalesRequestCount,\s*\}\);/,
      ],
      [
        'initial relative snapshot',
        /const a32RequestsAfterInitial = readA32RequestCounts\(\);/,
      ],
    ],
    'hidden-mount settlement and initial baseline',
  );
  assert.doesNotMatch(
    initialMounts,
    /assert\.equal\((?:groupBuy|order|fulfillment|afterSales)RequestCount,\s*\d+\)/,
    'initial A3.2 baselines must not use fixed absolute counts',
  );

  const groupRefresh = sourceBetween(
    smoke,
    /const catalogRequestsBeforeA32 = catalogRequestCount;/,
    /const ordersButton = groupedNavigation\.getByRole/,
    'group-buy exact isolation',
  );
  assertSourceOrder(
    groupRefresh,
    [
      [
        'prior feature baselines',
        /const financeRequestsBeforeA32 = financeRequestCount;\s*const operationsRequestsBeforeA32 = operationsRequestCount;\s*assert\.deepEqual\(readA32RequestCounts\(\), a32RequestsAfterInitial\);/,
      ],
      [
        'group-buy navigation',
        /const groupBuysButton = groupedNavigation\.getByRole\('button', \{\s*name: '团购管理',\s*exact: true,\s*\}\);\s*await groupBuysButton\.click\(\);\s*await assertActive\(groupBuysButton, '团购管理'\);\s*await page\.getByText\('团购列表', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'refresh-relative snapshot',
        /const a32RequestsBeforeGroupBuyRefresh = readA32RequestCounts\(\);/,
      ],
      [
        'active Shell refresh',
        /await shell\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.click\(\);/,
      ],
      [
        'group-buy response count',
        /await waitForCount\(\s*page,\s*\(\) => groupBuyRequestCount,\s*a32RequestsBeforeGroupBuyRefresh\.groupBuys \+ 1,\s*'group-buy active refresh',\s*\);/,
      ],
      [
        'group-buy exact +1',
        /assert\.equal\(\s*groupBuyRequestCount,\s*a32RequestsBeforeGroupBuyRefresh\.groupBuys \+ 1,\s*\);/,
      ],
      [
        'orders unchanged',
        /assert\.equal\(orderRequestCount, a32RequestsBeforeGroupBuyRefresh\.orders\);/,
      ],
      [
        'fulfillment unchanged',
        /assert\.equal\(\s*fulfillmentRequestCount,\s*a32RequestsBeforeGroupBuyRefresh\.fulfillment,\s*\);/,
      ],
      [
        'after-sales unchanged',
        /assert\.equal\(\s*afterSalesRequestCount,\s*a32RequestsBeforeGroupBuyRefresh\.afterSales,\s*\);/,
      ],
      [
        'catalog unchanged',
        /assert\.equal\(catalogRequestCount, catalogRequestsBeforeA32\);/,
      ],
      [
        'finance unchanged',
        /assert\.equal\(financeRequestCount, financeRequestsBeforeA32\);/,
      ],
      [
        'operations unchanged',
        /assert\.equal\(operationsRequestCount, operationsRequestsBeforeA32\);/,
      ],
    ],
    'group-buy exact isolation',
  );

  const orderFailureSetupRange = sourceRange(
    smoke,
    /const orderFailureRoute =/,
    /const a32RequestsBeforeOrderFailure = readA32RequestCounts\(\);/,
    'orders one-shot failure setup',
  );
  const orderFailureSetup = orderFailureSetupRange.source;
  assertSourceOrder(
    orderFailureSetup,
    [
      [
        'one-shot guard',
        /async \(route\) => \{\s*assert\.equal\(route\.request\(\)\.method\(\), 'GET'\);\s*assert\.equal\(orderFailureInjected, false\);\s*orderFailureInjected = true;/,
      ],
      [
        'one-shot 500 only',
        /await route\.fulfill\(\{\s*status: 500,\s*contentType: 'application\/json',\s*body: JSON\.stringify\(\{\s*success: false,\s*code: 'E2E_ORDER_FAILURE',/,
      ],
    ],
    'orders active one-shot failure setup',
  );
  assert.match(
    smoke,
    /let orderFailureInjected = false;/,
    'one-shot order failure starts disarmed',
  );
  const catalogFailureSetupRange = sourceRange(
    smoke,
    /const catalogRequestsBeforeRefresh = \{/,
    /const catalogRequestsBeforeFailure = \{/,
    'catalog one-shot failure setup',
  );
  const operationsFailureSetupRange = sourceRange(
    smoke,
    /const operationsRequestsAfterInitial = operationsRequestCount;/,
    /await shell\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.click\(\);/,
    'operations one-shot failure setup',
  );
  const routeRegistrations = registeredRoutes(smoke);
  assert.deepEqual(
    routeRegistrations.map(({ receiver, target }) => ({ receiver, target })),
    [
      {
        receiver: 'page',
        target: { kind: 'string', value: '**/api/categories' },
      },
      {
        receiver: 'context',
        target: {
          kind: 'string',
          value: '**/api/admin/orders/*/status',
        },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/orders/*/pickup-verify',
        },
      },
      {
        receiver: 'pickupConflictPage',
        target: {
          kind: 'string',
          value: '**/api/admin/orders/*/pickup-verify',
        },
      },
      {
        receiver: 'page',
        target: { kind: 'string', value: '**/api/admin/orders*' },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/purchase-plans',
        },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/operations/dashboard/overview',
        },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/logs/alerts',
        },
      },
    ],
    'route registration whitelist: five failure interceptors plus three real command proxies',
  );
  const [
    catalogRegistration,
    statusRaceRegistration,
    pickupRaceRegistration,
    pickupConflictRaceRegistration,
    orderRegistration,
    purchasePlanRegistration,
    operationsRegistration,
    alertRegistration,
  ] = routeRegistrations;
  assert.equal(
    statusRaceRegistration.handler,
    'statusRaceRoute',
    'route registration whitelist: status race uses the named real proxy',
  );
  assert.equal(
    pickupRaceRegistration.handler,
    'pickupRaceRoute',
    'route registration whitelist: pickup race uses the named real proxy',
  );
  assert.equal(
    pickupConflictRaceRegistration.handler,
    'pickupRaceRoute',
    'route registration whitelist: conflict page uses the named real proxy',
  );
  assert.equal(
    purchasePlanRegistration.target.value,
    '**/api/admin/purchase-plans',
    'route registration whitelist: purchase plans use the approved target',
  );
  assert.ok(
    catalogRegistration.start >= catalogFailureSetupRange.start &&
      catalogRegistration.end <= catalogFailureSetupRange.end,
    'route registration whitelist: catalog interceptor stays in its failure setup',
  );
  assert.match(
    catalogRegistration.handler,
    /async \(route\) => \{[\s\S]*?if \(!catalogFailureInjected\)[\s\S]*?status: 500[\s\S]*?code: 'E2E_CATALOG_FAILURE'[\s\S]*?await route\.continue\(\);[\s\S]*?\}/,
    'route registration whitelist: catalog uses its one-shot failure handler',
  );
  assert.equal(
    (catalogRegistration.handler.match(/\broute\.fulfill\(/g) ?? []).length,
    1,
    'route registration whitelist: catalog handler fulfills only its one failure',
  );
  assert.doesNotMatch(
    catalogRegistration.handler,
    /(?:status:\s*2\d\d|success:\s*true)/,
    'route registration whitelist: catalog handler cannot mock success',
  );
  assert.ok(
    orderRegistration.start >= orderFailureSetupRange.start &&
      orderRegistration.end <= orderFailureSetupRange.end,
    'route registration whitelist: order interceptor stays in its failure setup',
  );
  assert.equal(
    orderRegistration.handler,
    'orderFailureRoute',
    'route registration whitelist: orders use the named one-shot 500 handler',
  );
  assert.ok(
    operationsRegistration.start >= operationsFailureSetupRange.start &&
      operationsRegistration.end <= operationsFailureSetupRange.end,
    'route registration whitelist: operations interceptor stays in its failure setup',
  );
  assert.match(
    operationsRegistration.handler,
    /async \(route\) => \{[\s\S]*?if \(!operationsFailureInjected\)[\s\S]*?status: 500[\s\S]*?code: 'E2E_OPERATIONS_FAILURE'[\s\S]*?await route\.continue\(\);[\s\S]*?\}/,
    'route registration whitelist: operations uses its one-shot failure handler',
  );
  assert.equal(
    (operationsRegistration.handler.match(/\broute\.fulfill\(/g) ?? []).length,
    1,
    'route registration whitelist: operations handler fulfills only its one failure',
  );
  assert.doesNotMatch(
    operationsRegistration.handler,
    /(?:status:\s*2\d\d|success:\s*true)/,
    'route registration whitelist: operations handler cannot mock success',
  );
  assert.equal(
    alertRegistration.handler,
    'alertFailureRoute',
    'route registration whitelist: alerts use the named one-shot 500 handler',
  );
  const orderInterceptionPattern =
    /(?<![\w$.])(page|context)\s*\.\s*route\s*\(\s*(['"])\*\*\/api\/admin\/orders\*\2\s*,/g;
  const orderInterceptions = [...smoke.matchAll(orderInterceptionPattern)];
  assert.equal(
    orderInterceptions.length,
    1,
    'order interception registration: exactly one literal page/context route',
  );
  const orderInterception = orderInterceptions[0];
  assert.ok(
    orderInterception.index >= orderFailureSetupRange.start &&
      orderInterception.index < orderFailureSetupRange.end,
    'order interception registration: inside one-shot setup before failure refresh',
  );
  const registeredOrderHandler = smoke.slice(
    orderInterception.index,
    orderFailureSetupRange.end,
  );
  assert.match(
    registeredOrderHandler,
    /^(page|context)\s*\.\s*route\s*\(\s*(['"])\*\*\/api\/admin\/orders\*\2\s*,\s*orderFailureRoute\s*\);/,
    'order interception registration: uses the one-shot 500 handler',
  );
  assert.doesNotMatch(
    orderFailureSetup,
    /(?:status:\s*2\d\d|success:\s*true)/,
    'order interception registration: handler must not fulfill success',
  );
  assert.equal(
    (orderFailureSetup.match(/\broute\s*\.\s*fulfill\s*\(/g) ?? []).length,
    1,
    'order interception registration: one-shot handler fulfills exactly once',
  );

  const orderFailure = sourceBetween(
    smoke,
    /const a32RequestsBeforeOrderFailure = readA32RequestCounts\(\);/,
    /const afterSalesButton = groupedNavigation\.getByRole/,
    'order-local failure and Shell availability',
  );
  assertSourceOrder(
    orderFailure,
    [
      [
        'active orders refresh',
        /await shell\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.click\(\);/,
      ],
      [
        'order-local load error',
        /await page\.getByText\('订单列表加载失败', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'Shell heading available',
        /await page\.getByRole\('heading', \{ name: '社区甄选管理后台' \}\)\.waitFor\(\);/,
      ],
      [
        'Shell refresh available',
        /await page\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.waitFor\(\);/,
      ],
      [
        'Shell logout available',
        /await page\.getByRole\('button', \{ name: '退出登录', exact: true \}\)\.waitFor\(\);/,
      ],
      [
        '500 was injected',
        /assert\.equal\(orderFailureInjected, true\);/,
      ],
      [
        'failed refresh response counted',
        /await waitForCount\(\s*page,\s*\(\) => orderRequestCount,\s*a32RequestsBeforeOrderFailure\.orders \+ 1,\s*'order failed refresh',\s*\);/,
      ],
      [
        'group-buy unchanged on failure',
        /assert\.equal\(\s*groupBuyRequestCount,\s*a32RequestsBeforeOrderFailure\.groupBuys,\s*\);/,
      ],
      [
        'orders exact +1 on failure',
        /assert\.equal\(orderRequestCount, a32RequestsBeforeOrderFailure\.orders \+ 1\);/,
      ],
      [
        'fulfillment unchanged on failure',
        /assert\.equal\(\s*fulfillmentRequestCount,\s*a32RequestsBeforeOrderFailure\.fulfillment,\s*\);/,
      ],
      [
        'after-sales unchanged on failure',
        /assert\.equal\(\s*afterSalesRequestCount,\s*a32RequestsBeforeOrderFailure\.afterSales,\s*\);/,
      ],
      [
        'order route cleanup',
        /await page\.unroute\('\*\*\/api\/admin\/orders\*', orderFailureRoute\);/,
      ],
    ],
    'order-local failure and Shell availability',
  );

  const afterSalesRoundTrip = sourceBetween(
    smoke,
    /const afterSalesButton = groupedNavigation\.getByRole/,
    /const a32RequestsBeforeOrderRetry = readA32RequestCounts\(\);/,
    'after-sales round trip and persisted order error',
  );
  assertSourceOrder(
    afterSalesRoundTrip,
    [
      [
        'after-sales button',
        /name: '售后客服',\s*exact: true,\s*\}\);/,
      ],
      [
        'snapshot before leaving order error',
        /const a32RequestsDuringOrderError = readA32RequestCounts\(\);/,
      ],
      ['after-sales click', /await afterSalesButton\.click\(\);/],
      [
        'after-sales active',
        /await assertActive\(afterSalesButton, '售后客服'\);/,
      ],
      [
        'already-loaded after-sales rendered',
        /await page\.getByRole\('columnheader', \{ name: '售后单' \}\)\.waitFor\(\);/,
      ],
      [
        'no after-sales failure',
        /assert\.equal\(await page\.getByText\('售后客服加载失败'\)\.count\(\), 0\);/,
      ],
      [
        'navigation caused no A3.2 request',
        /assert\.deepEqual\(readA32RequestCounts\(\), a32RequestsDuringOrderError\);/,
      ],
      ['return to orders', /await ordersButton\.click\(\);/],
      [
        'orders active again',
        /await assertActive\(ordersButton, '订单管理'\);/,
      ],
      [
        'persisted order error',
        /await page\.getByText\('订单列表加载失败', \{ exact: true \}\)\.waitFor\(\);/,
      ],
    ],
    'after-sales round trip and persisted order error',
  );

  const orderRetry = sourceBetween(
    smoke,
    /const a32RequestsBeforeOrderRetry = readA32RequestCounts\(\);/,
    /const inventoryButton = groupedNavigation\.getByRole/,
    'successful real order retry and exact isolation',
  );
  assertSourceOrder(
    orderRetry,
    [
      [
        'successful response listener',
        /const orderRetryResponse = page\.waitForResponse\(\(response\) =>\s*new URL\(response\.url\(\)\)\.pathname === '\/api\/admin\/orders' && response\.ok\(\),\s*\);/,
      ],
      [
        'local retry click',
        /await page\.getByRole\('button', \{ name: \/重\\s\*试\/ \}\)\.click\(\);/,
      ],
      [
        'successful response awaited',
        /const orderResponse = await orderRetryResponse;/,
      ],
      [
        'real response body parsed',
        /const orderEnvelope = await orderResponse\.json\(\);/,
      ],
      [
        'success true envelope',
        /assert\.equal\(orderEnvelope\.success, true\);/,
      ],
      [
        'array data envelope',
        /assert\.equal\(Array\.isArray\(orderEnvelope\.data\.items\), true\);/,
      ],
      [
        'order error disappears',
        /await page\.getByText\('订单列表加载失败'\)\.waitFor\(\{ state: 'detached' \}\);/,
      ],
      [
        'order table renders',
        /await page\.getByText\('全渠道订单', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'retry response counted',
        /await waitForCount\(\s*page,\s*\(\) => orderRequestCount,\s*a32RequestsBeforeOrderRetry\.orders \+ 1,\s*'order retry',\s*\);/,
      ],
      [
        'group-buy unchanged on retry',
        /assert\.equal\(\s*groupBuyRequestCount,\s*a32RequestsBeforeOrderRetry\.groupBuys,\s*\);/,
      ],
      [
        'orders exact +1 on retry',
        /assert\.equal\(orderRequestCount, a32RequestsBeforeOrderRetry\.orders \+ 1\);/,
      ],
      [
        'fulfillment unchanged on retry',
        /assert\.equal\(\s*fulfillmentRequestCount,\s*a32RequestsBeforeOrderRetry\.fulfillment,\s*\);/,
      ],
      [
        'after-sales unchanged on retry',
        /assert\.equal\(\s*afterSalesRequestCount,\s*a32RequestsBeforeOrderRetry\.afterSales,\s*\);/,
      ],
      [
        'catalog unchanged on retry',
        /assert\.equal\(catalogRequestCount, catalogRequestsBeforeA32\);/,
      ],
      [
        'finance unchanged on retry',
        /assert\.equal\(financeRequestCount, financeRequestsBeforeA32\);/,
      ],
      [
        'operations unchanged on retry',
        /assert\.equal\(operationsRequestCount, operationsRequestsBeforeA32\);/,
      ],
    ],
    'successful real order retry and exact isolation',
  );
  assert.doesNotMatch(
    orderRetry,
    /(?:page\.route|route\.fulfill)/,
    'successful order response must not be mocked',
  );

  const navigationMatch = requireSourceMatch(
    smoke,
    /const navigation = \[([\s\S]*?)\];/,
    'navigation exclusion/count contract: navigation list',
  );
  const navigationLabels = [
    ...navigationMatch[1].matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);
  assert.equal(
    navigationLabels.length,
    23,
    'navigation exclusion/count contract: 23 total',
  );
  assert.equal(
    new Set(navigationLabels).size,
    23,
    'navigation exclusion/count contract: 23 unique',
  );
  const remainingNavigation = sourceBetween(
    smoke,
    /const remainingNavigation = navigation\.filter\(/,
    /for \(const label of remainingNavigation\)/,
    'navigation exclusion/count contract',
  );
  const exclusions = [
    ...remainingNavigation.matchAll(/label !== '([^']+)'/g),
  ].map((match) => match[1]);
  const explicitNavigation = [
    '商品管理',
    '团购管理',
    '订单管理',
    '售后客服',
    '库存管理',
    '采购计划',
    '批次库存',
    '财务对账',
    '运营看板',
    '提现管理',
    '告警中心',
    '税务人工 Review',
  ];
  assert.deepEqual(
    exclusions,
    explicitNavigation,
    'navigation exclusion/count contract: twelve explicit destinations',
  );
  assert.equal(
    navigationLabels.filter((label) => !exclusions.includes(label)).length,
    11,
    'navigation exclusion/count contract: 11 remaining destinations',
  );
  assertSourceOrder(
    smoke,
    [
      ['group-buy explicit click', /await groupBuysButton\.click\(\);/],
      ['orders explicit click', /await ordersButton\.click\(\);/],
      ['after-sales explicit click', /await afterSalesButton\.click\(\);/],
      ['inventory explicit click', /await inventoryButton\.click\(\);/],
      ['purchase-plan explicit click', /await purchasePlansButton\.click\(\);/],
      ['batches explicit click', /await batchesButton\.click\(\);/],
      ['product explicit click', /await productButton\.click\(\);/],
      ['finance explicit click', /await financeButton\.click\(\);/],
      ['operations explicit click', /await operationsButton\.click\(\);/],
      ['withdrawals explicit click', /await withdrawalsButton\.click\(\);/],
      ['alerts explicit click', /await alertsButton\.click\(\);/],
      ['tax review explicit click', /await taxReviewButton\.click\(\);/],
      [
        'remaining navigation loop',
        /for \(const label of remainingNavigation\) \{\s*const button = groupedNavigation\.getByRole\('button', \{ name: label, exact: true \}\);\s*await button\.click\(\);/,
      ],
      [
        '23/23 result',
        /`L50 Admin browser smoke passed: \$\{navigation\.length\}\/\$\{navigation\.length\} navigation items;/,
      ],
    ],
    'navigation exclusion/count contract',
  );
}

function assertA33SmokeContract(smoke) {
  assertSourceOrder(
    smoke,
    [
      [
        'inventory exact primary counter',
        /if \(pathname === '\/api\/admin\/inventory\/overview'\) \{\s*inventoryOverviewRequestCount \+= 1;\s*\}/,
      ],
      [
        'purchase-plan exact primary counter',
        /if \(pathname === '\/api\/admin\/purchase-plans'\) \{\s*purchasePlanRequestCount \+= 1;\s*\}/,
      ],
      [
        'supplier exact primary counter',
        /if \(pathname === '\/api\/admin\/suppliers'\) \{\s*supplierRequestCount \+= 1;\s*\}/,
      ],
      [
        'batches exact primary counter',
        /if \(pathname === '\/api\/admin\/inventory\/batches'\) \{\s*batchRequestCount \+= 1;\s*\}/,
      ],
      [
        'expiry-alert exact primary counter',
        /if \(\s*pathname === '\/api\/admin\/inventory\/expiry-alerts' &&\s*requestUrl\.search === '\?days=7'\s*\) \{\s*expiryAlertRequestCount \+= 1;\s*\}/,
      ],
      [
        'stock-check exact primary counter',
        /if \(pathname === '\/api\/admin\/stock-checks'\) \{\s*stockCheckRequestCount \+= 1;\s*\}/,
      ],
    ],
    'exact A3.3 primary request routing',
  );

  const initialMounts = sourceBetween(
    smoke,
    /await page\.getByText\(`当前管理员：\$\{credentials\.username\}`\)\.waitFor\(\);/,
    /const shell = page\.getByRole/,
    'A3.3 hidden-mount settlement and initial baseline',
  );
  assertSourceOrder(
    initialMounts,
    [
      [
        'inventory hidden mount started',
        /await waitForCount\(page, \(\) => inventoryOverviewRequestCount, 1, 'inventory initial load'\);/,
      ],
      [
        'purchase-plan hidden mount started',
        /await waitForCount\(page, \(\) => purchasePlanRequestCount, 1, 'purchase-plan initial load'\);/,
      ],
      [
        'supplier hidden mount started',
        /await waitForCount\(page, \(\) => supplierRequestCount, 1, 'supplier initial load'\);/,
      ],
      [
        'batches hidden mount started',
        /await waitForCount\(page, \(\) => batchRequestCount, 1, 'batch initial load'\);/,
      ],
      [
        'expiry-alert hidden mount started',
        /await waitForCount\(page, \(\) => expiryAlertRequestCount, 1, 'expiry-alert initial load'\);/,
      ],
      [
        'stock-check hidden mount started',
        /await waitForCount\(page, \(\) => stockCheckRequestCount, 1, 'stock-check initial load'\);/,
      ],
      [
        'hidden mounts settled',
        /await page\.waitForLoadState\('networkidle'\);/,
      ],
      [
        'relative A3.3 counter reader',
        /const readA33RequestCounts = \(\) => \(\{\s*inventory: inventoryOverviewRequestCount,\s*purchasePlans: purchasePlanRequestCount,\s*suppliers: supplierRequestCount,\s*batches: batchRequestCount,\s*expiryAlerts: expiryAlertRequestCount,\s*stockChecks: stockCheckRequestCount,\s*\}\);/,
      ],
      [
        'initial A3.3 snapshot',
        /const a33RequestsAfterInitial = readA33RequestCounts\(\);/,
      ],
      [
        'all-slice counter reader',
        /const readBusinessRequestCounts = \(\) => \(\{\s*catalog: catalogRequestCount,\s*finance: financeRequestCount,\s*operations: operationsRequestCount,\s*\.\.\.readA32RequestCounts\(\),\s*\.\.\.readA33RequestCounts\(\),\s*\.\.\.readA34RequestCounts\(\),\s*\}\);/,
      ],
    ],
    'A3.3 hidden-mount settlement and initial baseline',
  );
  assert.doesNotMatch(
    initialMounts,
    /assert\.equal\((?:inventoryOverview|purchasePlan|supplier|batch|expiryAlert|stockCheck)RequestCount,\s*\d+\)/,
    'initial A3.3 baselines must not use fixed absolute counts',
  );

  const inventoryRefresh = sourceBetween(
    smoke,
    /assert\.deepEqual\(readA33RequestCounts\(\), a33RequestsAfterOrderMutation\);/,
    /const purchasePlansButton = groupedNavigation\.getByRole/,
    'inventory active refresh exact isolation',
  );
  assertSourceOrder(
    inventoryRefresh,
    [
      [
        'inventory navigation',
        /const inventoryButton = groupedNavigation\.getByRole\('button', \{\s*name: '库存管理',\s*exact: true,\s*\}\);\s*await inventoryButton\.click\(\);\s*await assertActive\(inventoryButton, '库存管理'\);\s*await page\.getByRole\('columnheader', \{ name: '商品名' \}\)\.waitFor\(\);/,
      ],
      [
        'inventory refresh-relative snapshot',
        /const businessRequestsBeforeInventoryRefresh = readBusinessRequestCounts\(\);/,
      ],
      [
        'active Shell refresh',
        /await shell\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.click\(\);/,
      ],
      [
        'inventory response counted',
        /await waitForCount\(\s*page,\s*\(\) => inventoryOverviewRequestCount,\s*businessRequestsBeforeInventoryRefresh\.inventory \+ 1,\s*'inventory active refresh',\s*\);/,
      ],
      [
        'only inventory changed',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), \{\s*\.\.\.businessRequestsBeforeInventoryRefresh,\s*inventory: businessRequestsBeforeInventoryRefresh\.inventory \+ 1,\s*\}\);/,
      ],
    ],
    'inventory active refresh exact isolation',
  );

  const purchaseFailureSetupRange = sourceRange(
    smoke,
    /const purchasePlansButton = groupedNavigation\.getByRole/,
    /const businessRequestsBeforePurchaseFailure = readBusinessRequestCounts\(\);/,
    'purchase-plan active one-shot failure setup',
  );
  const purchaseFailureSetup = purchaseFailureSetupRange.source;
  assertSourceOrder(
    purchaseFailureSetup,
    [
      [
        'purchase plans active before route',
        /name: '采购计划',\s*exact: true,\s*\}\);\s*await purchasePlansButton\.click\(\);\s*await assertActive\(purchasePlansButton, '采购计划'\);\s*await page\.getByRole\('columnheader', \{ name: '计划编号' \}\)\.waitFor\(\);/,
      ],
      [
        'one-shot purchase-plan guard',
        /const purchasePlanFailureRoute = async \(route\) => \{\s*assert\.equal\(route\.request\(\)\.method\(\), 'GET'\);\s*assert\.equal\(purchasePlanFailureInjected, false\);\s*purchasePlanFailureInjected = true;/,
      ],
      [
        'one-shot purchase-plan 500 only',
        /await route\.fulfill\(\{\s*status: 500,\s*contentType: 'application\/json',\s*body: JSON\.stringify\(\{\s*success: false,\s*code: 'E2E_PURCHASE_PLAN_FAILURE',/,
      ],
      [
        'approved purchase-plan route',
        /await page\.route\('\*\*\/api\/admin\/purchase-plans', purchasePlanFailureRoute\);/,
      ],
    ],
    'purchase-plan active one-shot failure setup',
  );
  assert.match(
    smoke,
    /let purchasePlanFailureInjected = false;/,
    'one-shot purchase-plan failure starts disarmed',
  );
  assert.doesNotMatch(
    purchaseFailureSetup,
    /(?:status:\s*2\d\d|success:\s*true)/,
    'purchase-plan failure setup cannot mock success',
  );
  assert.equal(
    (purchaseFailureSetup.match(/\broute\s*\.\s*fulfill\s*\(/g) ?? []).length,
    1,
    'purchase-plan failure handler fulfills exactly once',
  );

  const routeRegistrations = registeredRoutes(smoke);
  assert.deepEqual(
    routeRegistrations.map(({ receiver, target }) => ({ receiver, target })),
    [
      {
        receiver: 'page',
        target: { kind: 'string', value: '**/api/categories' },
      },
      {
        receiver: 'context',
        target: {
          kind: 'string',
          value: '**/api/admin/orders/*/status',
        },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/orders/*/pickup-verify',
        },
      },
      {
        receiver: 'pickupConflictPage',
        target: {
          kind: 'string',
          value: '**/api/admin/orders/*/pickup-verify',
        },
      },
      {
        receiver: 'page',
        target: { kind: 'string', value: '**/api/admin/orders*' },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/purchase-plans',
        },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/operations/dashboard/overview',
        },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/logs/alerts',
        },
      },
    ],
    'A3.3 route registration whitelist: five failure interceptors plus three real command proxies',
  );
  const purchasePlanRegistration = routeRegistrations[5];
  assert.ok(
    purchasePlanRegistration.start >= purchaseFailureSetupRange.start &&
      purchasePlanRegistration.end <= purchaseFailureSetupRange.end,
    'purchase-plan interceptor stays in its one-shot failure setup',
  );
  assert.equal(
    purchasePlanRegistration.handler,
    'purchasePlanFailureRoute',
    'purchase-plan interceptor uses the named one-shot 500 handler',
  );

  const purchaseFailure = sourceBetween(
    smoke,
    /const businessRequestsBeforePurchaseFailure = readBusinessRequestCounts\(\);/,
    /const batchesButton = groupedNavigation\.getByRole/,
    'purchase-plan local failure and Shell availability',
  );
  assertSourceOrder(
    purchaseFailure,
    [
      [
        'active purchase-plan refresh',
        /await shell\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.click\(\);/,
      ],
      [
        'purchase-plan local load error',
        /await page\.getByText\('采购计划加载失败', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'Shell heading available',
        /await page\.getByRole\('heading', \{ name: '社区甄选管理后台' \}\)\.waitFor\(\);/,
      ],
      [
        'Shell refresh available',
        /await page\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.waitFor\(\);/,
      ],
      [
        'Shell logout available',
        /await page\.getByRole\('button', \{ name: '退出登录', exact: true \}\)\.waitFor\(\);/,
      ],
      [
        '500 was injected',
        /assert\.equal\(purchasePlanFailureInjected, true\);/,
      ],
      [
        'failed purchase-plan response counted',
        /await waitForCount\(\s*page,\s*\(\) => purchasePlanRequestCount,\s*businessRequestsBeforePurchaseFailure\.purchasePlans \+ 1,\s*'purchase-plan failed refresh',\s*\);/,
      ],
      [
        'only purchase plans changed on failure',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), \{\s*\.\.\.businessRequestsBeforePurchaseFailure,\s*purchasePlans: businessRequestsBeforePurchaseFailure\.purchasePlans \+ 1,\s*\}\);/,
      ],
      [
        'purchase-plan route cleanup',
        /await page\.unroute\('\*\*\/api\/admin\/purchase-plans', purchasePlanFailureRoute\);/,
      ],
    ],
    'purchase-plan local failure and Shell availability',
  );

  const batchesRoundTrip = sourceBetween(
    smoke,
    /const batchesButton = groupedNavigation\.getByRole/,
    /const businessRequestsBeforePurchaseRetry = readBusinessRequestCounts\(\);/,
    'batches round trip and persisted purchase-plan error',
  );
  assertSourceOrder(
    batchesRoundTrip,
    [
      [
        'snapshot before leaving purchase-plan error',
        /const businessRequestsDuringPurchaseError = readBusinessRequestCounts\(\);/,
      ],
      ['batches click', /await batchesButton\.click\(\);/],
      [
        'batches active',
        /await assertActive\(batchesButton, '批次库存'\);/,
      ],
      [
        'already-loaded batches rendered',
        /await page\.getByRole\('columnheader', \{ name: '批次号' \}\)\.waitFor\(\);/,
      ],
      [
        'no batches failure',
        /assert\.equal\(await page\.getByText\('批次库存加载失败'\)\.count\(\), 0\);/,
      ],
      [
        'navigation caused no business request',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), businessRequestsDuringPurchaseError\);/,
      ],
      ['return to purchase plans', /await purchasePlansButton\.click\(\);/],
      [
        'purchase plans active again',
        /await assertActive\(purchasePlansButton, '采购计划'\);/,
      ],
      [
        'persisted purchase-plan error',
        /await page\.getByText\('采购计划加载失败', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'round trip caused no business request',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), businessRequestsDuringPurchaseError\);/,
      ],
    ],
    'batches round trip and persisted purchase-plan error',
  );

  const purchaseRetry = sourceBetween(
    smoke,
    /const businessRequestsBeforePurchaseRetry = readBusinessRequestCounts\(\);/,
    /await productButton\.click\(\);/,
    'successful real purchase-plan retry and exact isolation',
  );
  assertSourceOrder(
    purchaseRetry,
    [
      [
        'successful purchase-plan response listener',
        /const purchasePlanRetryResponse = page\.waitForResponse\(\(response\) =>\s*new URL\(response\.url\(\)\)\.pathname === '\/api\/admin\/purchase-plans' &&\s*response\.ok\(\),\s*\);/,
      ],
      [
        'local purchase-plan retry click',
        /await page\.getByRole\('button', \{ name: \/重\\s\*试\/ \}\)\.click\(\);/,
      ],
      [
        'successful purchase-plan response awaited',
        /const purchasePlanResponse = await purchasePlanRetryResponse;/,
      ],
      [
        'real purchase-plan response parsed',
        /const purchasePlanEnvelope = await purchasePlanResponse\.json\(\);/,
      ],
      [
        'purchase-plan success envelope',
        /assert\.equal\(purchasePlanEnvelope\.success, true\);/,
      ],
      [
        'purchase-plan array envelope',
        /assert\.equal\(Array\.isArray\(purchasePlanEnvelope\.data\), true\);/,
      ],
      [
        'purchase-plan error disappears',
        /await page\.getByText\('采购计划加载失败'\)\.waitFor\(\{ state: 'detached' \}\);/,
      ],
      [
        'purchase-plan table renders',
        /await page\.getByRole\('columnheader', \{ name: '计划编号' \}\)\.waitFor\(\);/,
      ],
      [
        'purchase-plan retry counted',
        /await waitForCount\(\s*page,\s*\(\) => purchasePlanRequestCount,\s*businessRequestsBeforePurchaseRetry\.purchasePlans \+ 1,\s*'purchase-plan retry',\s*\);/,
      ],
      [
        'only purchase plans changed on retry',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), \{\s*\.\.\.businessRequestsBeforePurchaseRetry,\s*purchasePlans: businessRequestsBeforePurchaseRetry\.purchasePlans \+ 1,\s*\}\);/,
      ],
    ],
    'successful real purchase-plan retry and exact isolation',
  );
  assert.doesNotMatch(
    purchaseRetry,
    /(?:page\.route|context\.route|route\.fulfill)/,
    'successful purchase-plan response must not be mocked',
  );
}

function assertA34SmokeContract(smoke) {
  assertSourceOrder(
    smoke,
    [
      [
        'withdrawal exact primary counter',
        /if \(pathname === '\/api\/admin\/withdrawals'\) \{\s*withdrawalRequestCount \+= 1;\s*\}/,
      ],
      [
        'alert exact primary counter',
        /if \(pathname === '\/api\/admin\/logs\/alerts'\) \{\s*alertRequestCount \+= 1;\s*\}/,
      ],
      [
        'tax-review exact primary counter',
        /if \(pathname === '\/api\/admin\/tax-records'\) \{\s*taxReviewRequestCount \+= 1;\s*\}/,
      ],
    ],
    'exact A3.4 primary request routing',
  );

  const initialMounts = sourceBetween(
    smoke,
    /await page\.getByText\(`当前管理员：\$\{credentials\.username\}`\)\.waitFor\(\);/,
    /const shell = page\.getByRole/,
    'A3.4 hidden-mount settlement and initial baseline',
  );
  assertSourceOrder(
    initialMounts,
    [
      [
        'withdrawal hidden mount started',
        /await waitForCount\(page, \(\) => withdrawalRequestCount, 1, 'withdrawal initial load'\);/,
      ],
      [
        'alert hidden mount started',
        /await waitForCount\(page, \(\) => alertRequestCount, 1, 'alert initial load'\);/,
      ],
      [
        'tax-review hidden mount started',
        /await waitForCount\(page, \(\) => taxReviewRequestCount, 1, 'tax-review initial load'\);/,
      ],
      [
        'relative A3.4 counter reader',
        /const readA34RequestCounts = \(\) => \(\{\s*withdrawals: withdrawalRequestCount,\s*alerts: alertRequestCount,\s*taxReview: taxReviewRequestCount,\s*\}\);/,
      ],
      [
        'initial A3.4 snapshot',
        /const a34RequestsAfterInitial = readA34RequestCounts\(\);/,
      ],
    ],
    'A3.4 hidden-mount settlement and initial baseline',
  );

  const withdrawalRefresh = sourceBetween(
    smoke,
    /assert\.deepEqual\(readA34RequestCounts\(\), a34RequestsAfterOrderMutation\);/,
    /const alertsButton = groupedNavigation\.getByRole/,
    'withdrawal active refresh exact isolation',
  );
  assertSourceOrder(
    withdrawalRefresh,
    [
      ['withdrawal navigation', /await withdrawalsButton\.click\(\);/],
      [
        'withdrawal refresh snapshot',
        /const businessRequestsBeforeWithdrawalRefresh = readBusinessRequestCounts\(\);/,
      ],
      [
        'active Shell refresh',
        /await shell\.getByRole\('button', \{ name: \/刷\\s\*新\/ \}\)\.click\(\);/,
      ],
      [
        'withdrawal response counted',
        /businessRequestsBeforeWithdrawalRefresh\.withdrawals \+ 1,\s*'withdrawal active refresh'/,
      ],
      [
        'only withdrawal changed',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), \{\s*\.\.\.businessRequestsBeforeWithdrawalRefresh,\s*withdrawals: businessRequestsBeforeWithdrawalRefresh\.withdrawals \+ 1,\s*\}\);/,
      ],
    ],
    'withdrawal active refresh exact isolation',
  );

  const alertFailure = sourceBetween(
    smoke,
    /const alertsButton = groupedNavigation\.getByRole/,
    /const taxReviewButton = groupedNavigation\.getByRole/,
    'alert local failure and Shell availability',
  );
  assertSourceOrder(
    alertFailure,
    [
      ['alert navigation', /await alertsButton\.click\(\);/],
      [
        'one-shot alert guard',
        /const alertFailureRoute = async \(route\) => \{\s*assert\.equal\(route\.request\(\)\.method\(\), 'GET'\);\s*assert\.equal\(alertFailureInjected, false\);\s*alertFailureInjected = true;/,
      ],
      [
        'one-shot alert failure',
        /code: 'E2E_ALERT_FAILURE'/,
      ],
      [
        'approved alert route',
        /await page\.route\('\*\*\/api\/admin\/logs\/alerts', alertFailureRoute\);/,
      ],
      [
        'alert local error',
        /await page\.getByText\('运营告警加载失败', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'Shell survives',
        /await page\.getByRole\('heading', \{ name: '社区甄选管理后台' \}\)\.waitFor\(\);/,
      ],
      [
        'only alert changed',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), \{\s*\.\.\.businessRequestsBeforeAlertFailure,\s*alerts: businessRequestsBeforeAlertFailure\.alerts \+ 1,\s*\}\);/,
      ],
      [
        'alert route cleanup',
        /await page\.unroute\('\*\*\/api\/admin\/logs\/alerts', alertFailureRoute\);/,
      ],
    ],
    'alert local failure and Shell availability',
  );

  const taxRoundTrip = sourceBetween(
    smoke,
    /const taxReviewButton = groupedNavigation\.getByRole/,
    /const businessRequestsBeforeAlertRetry = readBusinessRequestCounts\(\);/,
    'tax-review round trip and persisted alert error',
  );
  assertSourceOrder(
    taxRoundTrip,
    [
      ['tax-review navigation', /await taxReviewButton\.click\(\);/],
      [
        'tax-review page rendered',
        /getByText\('税务人工 Review 工作台', \{ exact: true \}\)/,
      ],
      [
        'tax-review remains healthy',
        /assert\.equal\(await page\.getByText\('税务人工 Review 加载失败'\)\.count\(\), 0\);/,
      ],
      [
        'navigation caused no request',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), businessRequestsDuringAlertError\);/,
      ],
      ['return to alerts', /await alertsButton\.click\(\);/],
      [
        'alert error persisted',
        /await page\.getByText\('运营告警加载失败', \{ exact: true \}\)\.waitFor\(\);/,
      ],
    ],
    'tax-review round trip and persisted alert error',
  );

  const alertRetry = sourceBetween(
    smoke,
    /const businessRequestsBeforeAlertRetry = readBusinessRequestCounts\(\);/,
    /const remainingNavigation = navigation\.filter\(/,
    'successful real alert retry and exact isolation',
  );
  assertSourceOrder(
    alertRetry,
    [
      [
        'successful alert response listener',
        /const alertRetryResponse = page\.waitForResponse/,
      ],
      [
        'local alert retry',
        /await page\.getByRole\('button', \{ name: \/重\\s\*试\/ \}\)\.click\(\);/,
      ],
      ['alert success envelope', /assert\.equal\(alertEnvelope\.success, true\);/],
      [
        'alert array envelope',
        /assert\.equal\(Array\.isArray\(alertEnvelope\.data\), true\);/,
      ],
      [
        'alert error disappears',
        /await page\.getByText\('运营告警加载失败'\)\.waitFor\(\{ state: 'detached' \}\);/,
      ],
      [
        'only alert changed on retry',
        /assert\.deepEqual\(readBusinessRequestCounts\(\), \{\s*\.\.\.businessRequestsBeforeAlertRetry,\s*alerts: businessRequestsBeforeAlertRetry\.alerts \+ 1,\s*\}\);/,
      ],
    ],
    'successful real alert retry and exact isolation',
  );
  assert.doesNotMatch(
    alertRetry,
    /(?:page\.route|context\.route|route\.fulfill)/,
    'successful alert response must not be mocked',
  );
}

function assertB1ShellContract(smoke) {
  const groupedNavigation = sourceBetween(
    smoke,
    /const expectedNavigationSections = \[/,
    /const shell = page\.getByRole/,
    'B1 grouped navigation evidence',
  );

  assertSourceOrder(
    groupedNavigation,
    [
      [
        'navigation landmark',
        /getByRole\('navigation',\s*\{\s*name: '后台功能导航',?\s*\}\)/,
      ],
      [
        'visible heading read',
        /getByRole\('heading'\)\s*\.allTextContents\(\)/,
      ],
      [
        'visible group order',
        /assert\.deepEqual\(visibleNavigationSections, expectedNavigationSections\);/,
      ],
      [
        'empty group contract',
        /const hiddenNavigationSections = \['会员与营销', '门店与渠道', '系统管理'\];/,
      ],
      [
        'empty groups absent',
        /assert\.equal\(\s*await groupedNavigation\.getByText\(label, \{ exact: true \}\)\.count\(\),\s*0,\s*\);/,
      ],
    ],
    'B1 grouped navigation evidence',
  );

  assert.match(
    smoke,
    /const buttons = groupedNavigation\.getByRole\('button'\);/,
    'navigation button collection must be scoped to the grouped navigation landmark',
  );
  assert.match(
    smoke,
    /const button = groupedNavigation\.getByRole\('button', \{ name: label, exact: true \}\);/,
    'remaining navigation clicks must not search the page content region',
  );
  assert.match(
    smoke,
    /assert\.equal\(await buttons\.count\(\), navigation\.length\);/,
    'navigation evidence must count exactly the registered navigation items',
  );
}

function assertB2RoleWorkbenchContract(smoke) {
  assertSourceOrder(
    smoke,
    [
      [
        'workbench landmark',
        /const roleWorkbench = page\.getByRole\('region', \{\s*name: '今日经营角色工作台',\s*\}\);/,
      ],
      [
        'workbench visible after login',
        /await roleWorkbench\.waitFor\(\);/,
      ],
      [
        'initial operations settled',
        /await waitForCount\(\s*page,\s*\(\) => operationsRequestCount,\s*6,\s*'role-workbench operations load',\s*\);/,
      ],
      [
        'operations dashboard visible',
        /await page\.getByText\('近 7 日趋势表', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'owner profile',
        /await roleWorkbench\s*\.getByText\('当前工作台：经营负责人', \{ exact: true \}\)\s*\.waitFor\(\);/,
      ],
      [
        'workbench-scoped order shortcut',
        /const workbenchOrdersButton = roleWorkbench\.getByRole\('button', \{\s*name: '订单管理',\s*exact: true,\s*\}\);/,
      ],
      ['order shortcut click', /await workbenchOrdersButton\.click\(\);/],
      [
        'navigation order activation',
        /await assertActive\(ordersNavigationButton, '订单管理'\);/,
      ],
      ['product navigation click', /await productButton\.click\(\);/],
      [
        'legacy product baseline restored',
        /await page\.getByText\('商品列表', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      ['operations counter reset', /operationsRequestCount = 0;/],
    ],
    'B2 role workbench evidence',
  );

  assert.match(
    smoke,
    /const ordersNavigationButton = groupedNavigation\.getByRole\('button', \{\s*name: '订单管理',\s*exact: true,\s*\}\);/,
    'shortcut result must be verified in the navigation landmark',
  );
  assert.match(
    smoke,
    /assert\.equal\(await buttons\.count\(\), navigation\.length\);/,
    'B2 must retain exact coverage for all registered navigation items',
  );
}

function assertB3OmnichannelOrdersContract(
  smoke,
  fixture,
  orderPage,
  orderFilters,
) {
  assert.match(
    fixture,
    /const runSuffix = String\(\s*process\.env\.ADMIN_E2E_RUN_ID \?\? process\.env\.GITHUB_RUN_ID/,
    'B3 E2E fixture identity must be deterministic within one isolated run',
  );
  assert.match(
    fixture,
    /const pickupOrder = await prisma\.order\.create\(\{[\s\S]*?order_no: pickupOrderNo/,
    'B3 E2E must create the store pickup order in the fresh database',
  );
  assert.match(
    fixture,
    /const order = await prisma\.order\.create\(\{[\s\S]*?order_no: orderNo/,
    'B3 E2E must create the delivery order in the fresh database',
  );
  assert.match(
    fixture,
    /await prisma\.order\.deleteMany\(\{\s*where: \{ order_no: \{ in: \[orderNo, pickupOrderNo\] \} \},\s*\}\);/,
    'B3 E2E must remove both run-isolated orders during cleanup',
  );
  assert.match(
    orderFilters,
    /<Form[\s\S]*?onFinish=\{props\.onFinish\}[\s\S]*?<Button\s+type="primary"\s+htmlType="submit"\s*>/,
    'B3 query must use the standard Ant Design submit path',
  );
  assert.doesNotMatch(
    `${orderPage}\n${orderFilters}`,
    /form\.getFieldsValue\(\)/,
    'B3 query must not duplicate Form submission in an explicit click handler',
  );
  assertSourceOrder(
    smoke,
    [
      [
        'protected order counter',
        /if \(pathname === '\/api\/admin\/orders'\) \{\s*orderRequestCount \+= 1;\s*\}/,
      ],
      [
        'unauthenticated list denied',
        /const unauthenticatedOrdersResponse = await context\.request\.get\(\s*`\$\{baseURL\}\/api\/admin\/orders\?page=1&page_size=20`,\s*\);\s*assert\.equal\(unauthenticatedOrdersResponse\.status\(\), 401\);/,
      ],
      [
        'initial paginated envelope',
        /const initialOrdersEnvelope = await initialOrdersResponse\.json\(\);/,
      ],
      [
        'workbench heading',
        /await page\.getByText\('全渠道订单', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'filter landmark',
        /const orderFilter = page\.getByRole\('form', \{\s*name: '全渠道订单筛选',\s*\}\);/,
      ],
      [
        'keyword from real order',
        /const firstOrderNo = initialOrdersEnvelope\.data\.items\[0\]\.order_no;/,
      ],
      [
        'keyword input',
        /await orderFilter\.getByLabel\('订单关键词'\)\.fill\(firstOrderNo\);/,
      ],
      [
        'real filtered request',
        /const filteredOrdersResponse = page\.waitForResponse\(/,
      ],
      [
        'query submit',
        /await orderFilter\s*\.getByRole\('button', \{ name: \/查\\s\*询\/ \}\)\s*\.click\(\);/,
      ],
      [
        'paginated items verified',
        /assert\.equal\(Array\.isArray\(filteredOrdersEnvelope\.data\.items\), true\);/,
      ],
      [
        'invalid status rejected',
        /const invalidOrdersResponse = await context\.request\.get\(\s*`\$\{baseURL\}\/api\/admin\/orders\?pay_status=unknown`,\s*\);\s*assert\.equal\(invalidOrdersResponse\.status\(\), 400\);/,
      ],
      [
        'raw phone absent',
        /assert\.equal\(Object\.hasOwn\(filteredOrder, 'receiver_phone'\), false\);/,
      ],
      [
        'raw address absent',
        /assert\.equal\(Object\.hasOwn\(filteredOrder, 'receiver_address'\), false\);/,
      ],
      [
        'channel column visible',
        /await page\.getByRole\('columnheader', \{ name: '渠道' \}\)\.waitFor\(\);/,
      ],
      [
        'historical channel visible',
        /await page\.getByText\('微信小程序', \{ exact: true \}\)\.first\(\)\.waitFor\(\);/,
      ],
    ],
    'B3 omnichannel order workbench evidence',
  );

  assert.match(
    smoke,
    /await page\.route\('\*\*\/api\/admin\/orders\*', orderFailureRoute\);/,
    'order failure evidence must target only the protected list route',
  );
  assert.match(
    smoke,
    /await page\.unroute\('\*\*\/api\/admin\/orders\*', orderFailureRoute\);/,
    'protected order failure route must be removed before real retry',
  );
}

test('L50 Admin browser smoke infrastructure is complete', () => {
  const required = [
    'scripts/admin-e2e/package.json',
    'scripts/admin-e2e/pnpm-lock.yaml',
    'scripts/admin-e2e/admin-smoke.mjs',
    'scripts/admin-e2e/fixture.ts',
    'scripts/admin-e2e/run.cjs',
  ];
  for (const file of required) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `missing ${file}`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['setup:admin:e2e'], 'pnpm --dir scripts/admin-e2e --ignore-workspace install --frozen-lockfile');
  assert.equal(pkg.scripts['e2e:admin'], 'node scripts/admin-e2e/run.cjs');

  const workspace = fs.readFileSync(
    path.join(root, 'apps/admin/src/app/AdminFeatureWorkspace.tsx'),
    'utf8',
  );
  assert.match(workspace, /__ADMIN_E2E_FORCE_RENDER_ERROR__/);
});

test('Admin E2E starts API and Admin natively on the runner', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/admin-e2e/run.cjs'), 'utf8');
  const viteConfig = fs.readFileSync(path.join(root, 'apps/admin/vite.config.ts'), 'utf8');

  assert.doesNotMatch(runner, /docker-compose\.e2e\.yml/);
  assert.doesNotMatch(runner, /['"]postgres['"],\s*['"]api['"],\s*['"]admin['"]/);
  assert.doesNotMatch(runner, /VITE_API_BASE_URL:\s*['"]https?:\/\//);
  assert.match(viteConfig, /['"]\/api['"]:\s*['"]http:\/\/localhost:13080['"]/);
  assert.match(runner, /@community-selection\/api/);
  assert.match(runner, /@community-selection\/admin/);
  assert.match(runner, /ADMIN_E2E_DATABASE_URL/);
});

test('Admin E2E keeps a native browser path for a physical runner', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/admin-e2e/run.cjs'), 'utf8');

  assert.match(runner, /if \(!existsSync\('\/\.dockerenv'\)\)/);
  assert.match(runner, /pnpm[\s\S]*--dir[\s\S]*scripts\/admin-e2e[\s\S]*test/);
});

test('A container runner executes Chromium in the matching Playwright image', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/admin-e2e/run.cjs'), 'utf8');

  assert.match(runner, /mcr\.microsoft\.com\/playwright:v\$\{playwrightVersion\}-noble/);
  assert.match(runner, /--network[\s\S]*container:\$\{runnerContainerId\}/);
  assert.match(runner, /PLAYWRIGHT_BROWSERS_PATH/);
  assert.match(runner, /docker[\s\S]*cp[\s\S]*admin-smoke\.mjs/);
});


test('Admin E2E verifies lazy feature requests, active refresh, and local retry', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );
  const catalogProductForm = fs.readFileSync(
    path.join(
      root,
      'apps/admin/src/features/catalog/products/CatalogProductForm.tsx',
    ),
    'utf8',
  );

  assert.match(smoke, /catalogRequestCount/);
  assert.match(smoke, /categoryRequestCount/);
  assert.match(smoke, /productRequestCount/);
  assert.match(smoke, /financeRequestCount/);
  assert.match(smoke, /operationsRequestCount/);
  assert.match(smoke, /catalogRequestsAfterInitial/);
  assert.match(smoke, /catalogRequestsBeforeRefresh/);
  assert.match(smoke, /catalogFailureInjected/);
  assert.match(smoke, /catalogDraftName/);
  assert.match(smoke, /groupBuysButton/);
  assert.match(smoke, /categoryRetryResponse/);
  assert.match(smoke, /productRetryResponse/);
  assert.match(smoke, /financeRequestsAfterInitial/);
  assert.match(smoke, /financeRequestsBeforeSelection/);
  assert.match(smoke, /operationsRequestsBeforeSelection/);
  assert.match(smoke, /operationsFailureInjected/);
  assert.match(smoke, /商品目录加载失败/);
  assert.match(smoke, /财务对账加载失败/);
  assert.match(smoke, /运营看板加载失败/);
  assert.match(smoke, /getByRole\('button', \{ name: \/重\\s\*试\//);
  assert.match(catalogProductForm, /aria-label="商品名称"/);
});

test('Admin E2E proves A3.2 request isolation and order-local recovery', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.doesNotThrow(() => assertA32SmokeContract(smoke));
});

test('Admin E2E proves A3.3 request isolation and purchase-plan recovery', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.doesNotThrow(() => assertA33SmokeContract(smoke));
});

test('Admin E2E proves A3.4 request isolation and alert-local recovery', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.doesNotThrow(() => assertA34SmokeContract(smoke));
});

test('Admin E2E proves B1 grouped navigation and hides empty modules', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.doesNotThrow(() => assertB1ShellContract(smoke));
});

test('Admin E2E proves B2 role workbench landing and shortcut navigation', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.doesNotThrow(() => assertB2RoleWorkbenchContract(smoke));
});

test('Admin E2E proves B3 protected omnichannel orders', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );
  const fixture = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/fixture.ts'),
    'utf8',
  );
  const orderPage = fs.readFileSync(
    path.join(
      root,
      'apps/admin/src/features/sales/orders/OrdersPage.tsx',
    ),
    'utf8',
  );
  const orderFilters = fs.readFileSync(
    path.join(
      root,
      'apps/admin/src/features/sales/orders/OrdersFilters.tsx',
    ),
    'utf8',
  );

  assert.doesNotThrow(() =>
    assertB3OmnichannelOrdersContract(
      smoke,
      fixture,
      orderPage,
      orderFilters,
    ),
  );
});

test('C1 defines the bounded traceable Admin order contract', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );
  const shared = fs.readFileSync(
    path.join(root, 'packages/shared/src/index.ts'),
    'utf8',
  );
  const query = fs.readFileSync(
    path.join(
      root,
      'apps/api/src/routes/admin/order-list-query.ts',
    ),
    'utf8',
  );
  const route = fs.readFileSync(
    path.join(root, 'apps/api/src/routes/admin/orders.ts'),
    'utf8',
  );
  const orderTypes = fs.readFileSync(
    path.join(
      root,
      'apps/admin/src/features/sales/orders/types.ts',
    ),
    'utf8',
  );
  const workspacePackages = fs.readFileSync(
    path.join(root, 'apps/admin/src/workspace-packages.d.ts'),
    'utf8',
  );
  const ordersTable = fs.readFileSync(
    path.join(
      root,
      'apps/admin/src/features/sales/orders/OrdersTable.tsx',
    ),
    'utf8',
  );

  assert.match(shared, /export type PaginatedData<T>/);
  assert.match(shared, /export function contractOk/);
  assert.match(shared, /export function contractFail/);
  assert.match(query, /MAX_ADMIN_ORDER_PAGE = 10_000/);
  assert.match(route, /buildPaginationMetadata/);
  assert.match(route, /contractOk/);
  assert.match(route, /contractFail/);
  assert.match(route, /const traceId = String\(request\.id\)/);
  assert.match(route, /code: 'ADMIN_ORDERS_LISTED'/);
  assert.match(route, /code: 'ADMIN_ORDERS_LIST_FAILED'/);
  assert.match(route, /request\.log\.error/);
  assert.match(
    orderTypes,
    /AdminOrderListResponse =\s*PaginatedData<AdminOrderListItem>/,
  );
  assert.match(workspacePackages, /export type PaginatedData<T>/);
  assert.match(workspacePackages, /export function contractOk/);
  assert.match(workspacePackages, /export function contractFail/);
  assert.match(workspacePackages, /export function buildPaginationMetadata/);
  assert.match(ordersTable, /props\.data\.pagination\.page/);
  assert.match(ordersTable, /props\.data\.pagination\.page_size/);
  assert.match(ordersTable, /props\.data\.pagination\.total/);
  assert.match(
    smoke,
    /const unauthenticatedOrdersEnvelope =\s*await unauthenticatedOrdersResponse\.json\(\);/,
  );
  assert.match(
    smoke,
    /assert\.equal\(unauthenticatedOrdersEnvelope\.success, false\);/,
  );
  assert.match(
    smoke,
    /assert\.equal\(initialOrdersEnvelope\.code, 'ADMIN_ORDERS_LISTED'\);/,
  );
  assert.match(
    smoke,
    /assert\.equal\(typeof initialOrdersEnvelope\.trace_id, 'string'\);/,
  );
  assert.match(
    smoke,
    /assert\.equal\(\s*typeof initialOrdersEnvelope\.data\.pagination\.total,\s*'number',\s*\);/,
  );
  assert.match(
    smoke,
    /assert\.equal\(\s*invalidOrdersEnvelope\.code,\s*'INVALID_ADMIN_ORDER_QUERY',\s*\);/,
  );
  assert.match(
    smoke,
    /\/api\/admin\/orders\?page=10001&page_size=100/,
  );
  assert.match(
    smoke,
    /assert\.equal\(oversizedPageResponse\.status\(\), 400\);/,
  );
});

test('A3.2 source contract rejects weakened behavior evidence', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );
  const mutations = [
    {
      name: 'hidden-mount settlement',
      expected: /hidden-mount settlement and initial baseline/,
      weaken: (source) =>
        source.replace("  await page.waitForLoadState('networkidle');\n", ''),
    },
    {
      name: 'order route cleanup',
      expected: /order route cleanup/,
      weaken: (source) =>
        source.replace(
          "  await page.unroute('**/api/admin/orders*', orderFailureRoute);\n",
          '',
        ),
    },
    {
      name: 'After-sales round trip and persisted order error',
      expected: /after-sales round trip and persisted order error/,
      weaken: (source) =>
        source.replace(
          /  await ordersButton\.click\(\);\n  await assertActive\(ordersButton, '订单管理'\);\n  await page\.getByText\('订单列表加载失败', \{ exact: true \}\)\.waitFor\(\);\n\n(?=  const a32RequestsBeforeOrderRetry)/,
          '',
        ),
    },
    {
      name: 'successful response envelope validation',
      expected: /successful real order retry and exact isolation/,
      weaken: (source) =>
        source.replace(
          "  assert.equal(orderEnvelope.success, true);\n  assert.equal(Array.isArray(orderEnvelope.data.items), true);\n",
          '',
        ),
    },
    {
      name: 'group-buy exact isolation assertion block',
      expected: /group-buy exact isolation/,
      weaken: (source) =>
        source.replace(
          '  assert.equal(orderRequestCount, a32RequestsBeforeGroupBuyRefresh.orders);\n',
          '',
        ),
    },
    {
      name: 'retry exact isolation assertion block',
      expected: /successful real order retry and exact isolation/,
      weaken: (source) =>
        source.replace(
          '  assert.equal(orderRequestCount, a32RequestsBeforeOrderRetry.orders + 1);\n',
          '',
        ),
    },
    {
      name: 'successful orders response mock',
      expected:
        /route registration whitelist|order interception registration|successful order response must not be mocked/,
      weaken: (source) =>
        source.replace(
          '  const orderRetryResponse = page.waitForResponse',
          "  await page.route('**/api/admin/orders*', async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: { total: 0, page: 1, page_size: 20, items: [] } }) }));\n  const orderRetryResponse = page.waitForResponse",
        ),
    },
    {
      name: 'broad glob successful orders route',
      expected: /route registration whitelist/,
      weaken: (source) =>
        source.replace(
          'try {\n',
          "await page.route('**/api/**', async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) }));\n\n" +
            'try {\n',
        ),
    },
    {
      name: 'RegExp successful orders route',
      expected: /route registration whitelist/,
      weaken: (source) =>
        source.replace(
          'try {\n',
          'await context.route(/\\/api\\/admin\\/orders(?:\\?.*)?$/, async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: { total: 0, page: 1, page_size: 20, items: [] } }) }));\n\n' +
            'try {\n',
        ),
    },
    {
      name: 'predeclared success handler replaces the failure registration',
      expected:
        /route registration whitelist: orders use the named one-shot 500 handler|order interception registration: uses the one-shot 500 handler/,
      weaken: (source) =>
        source.replace(
          "  await page.route('**/api/admin/orders*', orderFailureRoute);\n",
          '  const e2eOrderSuccessHandler = async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) });\n' +
            '  await page.route("**/api/admin/orders*", e2eOrderSuccessHandler);\n',
        ),
    },
    {
      name: 'approved order registration relocated into the retry slice',
      expected:
        /route registration whitelist: order interceptor stays in its failure setup|order interception registration: inside one-shot setup before failure refresh/,
      weaken: (source) =>
        source
          .replace(
            "  await page.route('**/api/admin/orders*', orderFailureRoute);\n",
            '',
          )
          .replace(
            '  const a32RequestsBeforeOrderRetry = readA32RequestCounts();',
            "  await page.route('**/api/admin/orders*', orderFailureRoute);\n" +
              '  const a32RequestsBeforeOrderRetry = readA32RequestCounts();',
          ),
    },
    {
      name: 'navigation exclusion and count',
      expected: /navigation exclusion\/count contract/,
      weaken: (source) =>
        source.replace("      label !== '售后客服' &&\n", ''),
    },
  ];

  for (const mutation of mutations) {
    const weakened = mutation.weaken(smoke);
    assert.notEqual(weakened, smoke, `${mutation.name}: mutation applied`);
    assert.throws(
      () => assertA32SmokeContract(weakened),
      mutation.expected,
      mutation.name,
    );
  }
});

test('A3.3 source contract rejects weakened behavior evidence', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );
  const mutations = [
    {
      name: 'A3.3 hidden-mount settlement',
      expected: /A3\.3 hidden-mount settlement and initial baseline/,
      weaken: (source) =>
        source.replace(
          "  await waitForCount(page, () => stockCheckRequestCount, 1, 'stock-check initial load');\n",
          '',
        ),
    },
    {
      name: 'purchase-plan route cleanup',
      expected: /purchase-plan route cleanup/,
      weaken: (source) =>
        source.replace(
          "  await page.unroute('**/api/admin/purchase-plans', purchasePlanFailureRoute);\n",
          '',
        ),
    },
    {
      name: 'batches round trip and persisted purchase-plan error',
      expected: /batches round trip and persisted purchase-plan error/,
      weaken: (source) =>
        source.replace(
          /  await purchasePlansButton\.click\(\);\n  await assertActive\(purchasePlansButton, '采购计划'\);\n  await page\.getByText\('采购计划加载失败', \{ exact: true \}\)\.waitFor\(\);\n  assert\.deepEqual\(readBusinessRequestCounts\(\), businessRequestsDuringPurchaseError\);\n\n(?=  const businessRequestsBeforePurchaseRetry)/,
          '',
        ),
    },
    {
      name: 'purchase-plan success envelope validation',
      expected: /successful real purchase-plan retry and exact isolation/,
      weaken: (source) =>
        source.replace(
          "  assert.equal(purchasePlanEnvelope.success, true);\n  assert.equal(Array.isArray(purchasePlanEnvelope.data), true);\n",
          '',
        ),
    },
    {
      name: 'inventory exact isolation assertion',
      expected: /inventory active refresh exact isolation/,
      weaken: (source) =>
        source.replace(
          '    inventory: businessRequestsBeforeInventoryRefresh.inventory + 1,\n',
          '',
        ),
    },
    {
      name: 'purchase-plan failure exact isolation assertion',
      expected: /purchase-plan local failure and Shell availability/,
      weaken: (source) =>
        source.replace(
          '    purchasePlans: businessRequestsBeforePurchaseFailure.purchasePlans + 1,\n',
          '',
        ),
    },
    {
      name: 'purchase-plan retry exact isolation assertion',
      expected: /successful real purchase-plan retry and exact isolation/,
      weaken: (source) =>
        source.replace(
          '    purchasePlans: businessRequestsBeforePurchaseRetry.purchasePlans + 1,\n',
          '',
        ),
    },
    {
      name: 'successful purchase-plan response mock',
      expected:
        /A3\.3 route registration whitelist|successful purchase-plan response must not be mocked/,
      weaken: (source) =>
        source.replace(
          '  const purchasePlanRetryResponse = page.waitForResponse',
          "  await page.route('**/api/admin/purchase-plans', async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) }));\n  const purchasePlanRetryResponse = page.waitForResponse",
        ),
    },
    {
      name: 'broad glob successful purchase-plan route',
      expected: /A3\.3 route registration whitelist/,
      weaken: (source) =>
        source.replace(
          'try {\n',
          "await page.route('**/api/admin/**', async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) }));\n\n" +
            'try {\n',
        ),
    },
    {
      name: 'RegExp successful purchase-plan route',
      expected: /A3\.3 route registration whitelist/,
      weaken: (source) =>
        source.replace(
          'try {\n',
          'await context.route(/\\/api\\/admin\\/purchase-plans(?:\\?.*)?$/, async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) }));\n\n' +
            'try {\n',
        ),
    },
    {
      name: 'predeclared purchase-plan success handler replaces failure',
      expected:
        /approved purchase-plan route|purchase-plan interceptor uses the named one-shot 500 handler/,
      weaken: (source) =>
        source.replace(
          "  await page.route('**/api/admin/purchase-plans', purchasePlanFailureRoute);\n",
          '  const e2ePurchasePlanSuccessHandler = async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) });\n' +
            '  await page.route("**/api/admin/purchase-plans", e2ePurchasePlanSuccessHandler);\n',
        ),
    },
    {
      name: 'approved purchase-plan registration relocated into retry',
      expected:
        /approved purchase-plan route|purchase-plan interceptor stays in its one-shot failure setup/,
      weaken: (source) =>
        source
          .replace(
            "  await page.route('**/api/admin/purchase-plans', purchasePlanFailureRoute);\n",
            '',
          )
          .replace(
            '  const businessRequestsBeforePurchaseRetry = readBusinessRequestCounts();',
            "  await page.route('**/api/admin/purchase-plans', purchasePlanFailureRoute);\n" +
              '  const businessRequestsBeforePurchaseRetry = readBusinessRequestCounts();',
          ),
    },
  ];

  for (const mutation of mutations) {
    const weakened = mutation.weaken(smoke);
    assert.notEqual(weakened, smoke, `${mutation.name}: mutation applied`);
    assert.throws(
      () => assertA33SmokeContract(weakened),
      mutation.expected,
      mutation.name,
    );
  }
});
