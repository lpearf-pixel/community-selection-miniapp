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
        node.expression.expression.text === 'context') &&
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
        /if \(pathname === '\/api\/orders'\) \{\s*orderRequestCount \+= 1;\s*\}/,
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
    /const ordersButton = shell\.getByRole/,
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
        /const groupBuysButton = shell\.getByRole\('button', \{\s*name: '团购管理',\s*exact: true,\s*\}\);\s*await groupBuysButton\.click\(\);\s*await assertActive\(groupBuysButton, '团购管理'\);\s*await page\.getByText\('团购列表', \{ exact: true \}\)\.waitFor\(\);/,
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
    /const ordersButton = shell\.getByRole/,
    /const a32RequestsBeforeOrderFailure = readA32RequestCounts\(\);/,
    'orders active one-shot failure setup',
  );
  const orderFailureSetup = orderFailureSetupRange.source;
  assertSourceOrder(
    orderFailureSetup,
    [
      [
        'orders active before route',
        /name: '订单管理',\s*exact: true,\s*\}\);\s*await ordersButton\.click\(\);\s*await assertActive\(ordersButton, '订单管理'\);\s*await page\.getByText\('订单列表', \{ exact: true \}\)\.waitFor\(\);/,
      ],
      [
        'one-shot guard',
        /const orderFailureRoute = async \(route\) => \{\s*assert\.equal\(route\.request\(\)\.method\(\), 'GET'\);\s*assert\.equal\(orderFailureInjected, false\);\s*orderFailureInjected = true;/,
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
        receiver: 'page',
        target: { kind: 'string', value: '**/api/orders' },
      },
      {
        receiver: 'page',
        target: {
          kind: 'string',
          value: '**/api/admin/operations/dashboard/overview',
        },
      },
    ],
    'route registration whitelist: only the three approved failure interceptors',
  );
  const [catalogRegistration, orderRegistration, operationsRegistration] =
    routeRegistrations;
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
  const orderInterceptionPattern =
    /(?<![\w$.])(page|context)\s*\.\s*route\s*\(\s*(['"])\*\*\/api\/orders\2\s*,/g;
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
    /^(page|context)\s*\.\s*route\s*\(\s*(['"])\*\*\/api\/orders\2\s*,\s*orderFailureRoute\s*\);/,
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
    /const afterSalesButton = shell\.getByRole/,
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
        /await page\.unroute\('\*\*\/api\/orders', orderFailureRoute\);/,
      ],
    ],
    'order-local failure and Shell availability',
  );

  const afterSalesRoundTrip = sourceBetween(
    smoke,
    /const afterSalesButton = shell\.getByRole/,
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
    /await productButton\.click\(\);/,
    'successful real order retry and exact isolation',
  );
  assertSourceOrder(
    orderRetry,
    [
      [
        'successful response listener',
        /const orderRetryResponse = page\.waitForResponse\(\(response\) =>\s*new URL\(response\.url\(\)\)\.pathname === '\/api\/orders' && response\.ok\(\),\s*\);/,
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
        /assert\.equal\(Array\.isArray\(orderEnvelope\.data\), true\);/,
      ],
      [
        'order error disappears',
        /await page\.getByText\('订单列表加载失败'\)\.waitFor\(\{ state: 'detached' \}\);/,
      ],
      [
        'order table renders',
        /await page\.getByText\('订单列表', \{ exact: true \}\)\.waitFor\(\);/,
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
    '财务对账',
    '运营看板',
  ];
  assert.deepEqual(
    exclusions,
    explicitNavigation,
    'navigation exclusion/count contract: six explicit destinations',
  );
  assert.equal(
    navigationLabels.filter((label) => !exclusions.includes(label)).length,
    17,
    'navigation exclusion/count contract: 17 remaining destinations',
  );
  assertSourceOrder(
    smoke,
    [
      ['group-buy explicit click', /await groupBuysButton\.click\(\);/],
      ['orders explicit click', /await ordersButton\.click\(\);/],
      ['after-sales explicit click', /await afterSalesButton\.click\(\);/],
      ['product explicit click', /await productButton\.click\(\);/],
      ['finance explicit click', /await financeButton\.click\(\);/],
      ['operations explicit click', /await operationsButton\.click\(\);/],
      [
        'remaining navigation loop',
        /for \(const label of remainingNavigation\) \{\s*const button = shell\.getByRole\('button', \{ name: label, exact: true \}\);\s*await button\.click\(\);/,
      ],
      [
        '23/23 result',
        /`L50 Admin browser smoke passed: \$\{navigation\.length\}\/\$\{navigation\.length\} navigation items;/,
      ],
    ],
    'navigation exclusion/count contract',
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
  const catalogPage = fs.readFileSync(
    path.join(
      root,
      'apps/admin/src/features/catalog/products/CatalogProductsPage.tsx',
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
  assert.match(catalogPage, /aria-label="商品名称"/);
});

test('Admin E2E proves A3.2 request isolation and order-local recovery', () => {
  const smoke = fs.readFileSync(
    path.join(root, 'scripts/admin-e2e/admin-smoke.mjs'),
    'utf8',
  );

  assert.doesNotThrow(() => assertA32SmokeContract(smoke));
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
          "  await page.unroute('**/api/orders', orderFailureRoute);\n",
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
          "  assert.equal(orderEnvelope.success, true);\n  assert.equal(Array.isArray(orderEnvelope.data), true);\n",
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
          "  await page.route('**/api/orders', async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) }));\n  const orderRetryResponse = page.waitForResponse",
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
          'await context.route(/\\/api\\/orders(?:\\?.*)?$/, async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) }));\n\n' +
            'try {\n',
        ),
    },
    {
      name: 'predeclared success handler replaces the failure registration',
      expected:
        /route registration whitelist: orders use the named one-shot 500 handler|order interception registration: uses the one-shot 500 handler/,
      weaken: (source) =>
        source.replace(
          "  await page.route('**/api/orders', orderFailureRoute);\n",
          '  const e2eOrderSuccessHandler = async (route) => route.fulfill({ body: JSON.stringify({ success: true, data: [] }) });\n' +
            '  await page.route("**/api/orders", e2eOrderSuccessHandler);\n',
        ),
    },
    {
      name: 'approved order registration relocated into the retry slice',
      expected:
        /route registration whitelist: order interceptor stays in its failure setup|order interception registration: inside one-shot setup before failure refresh/,
      weaken: (source) =>
        source
          .replace(
            "  await page.route('**/api/orders', orderFailureRoute);\n",
            '',
          )
          .replace(
            '  const a32RequestsBeforeOrderRetry = readA32RequestCounts();',
            "  await page.route('**/api/orders', orderFailureRoute);\n" +
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
