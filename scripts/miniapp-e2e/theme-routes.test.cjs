const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/miniapp/app.json'), 'utf8'));
const { buildThemeRoutes } = require('./theme-routes.cjs');

test('theme smoke covers every registered page once with unique screenshots', () => {
  const routes = buildThemeRoutes({
    productId: 'product-1',
    groupBuyId: 'group-1',
    orderId: 'order-1',
  });
  assert.equal(routes.length, 19);
  assert.deepEqual(routes.map((item) => item.path), app.pages);
  assert.equal(new Set(routes.map((item) => item.screenshot)).size, 19);
});

test('detail and form routes receive deterministic fixture queries', () => {
  const routes = buildThemeRoutes({
    productId: 'product / 1',
    groupBuyId: 'group / 1',
    orderId: 'order / 1',
  });
  const byPath = Object.fromEntries(routes.map((route) => [route.path, route]));
  assert.equal(byPath['pages/product-detail/index'].query, '?id=product%20%2F%201');
  assert.equal(byPath['pages/group-buy-detail/index'].query, '?id=group%20%2F%201');
  assert.equal(byPath['pages/join-order/index'].query, '?group_buy_id=group%20%2F%201');
  assert.equal(byPath['pages/orders/detail/index'].query, '?id=order%20%2F%201');
  assert.equal(byPath['pages/after-sales/apply/index'].query, '?order_id=order%20%2F%201');
  assert.equal(byPath['pages/leader/center/index'].role, 'leader');
});

test('theme smoke captures root visibility exceptions results and one screenshot per route', () => {
  const sourcePath = path.join(__dirname, 'theme-smoke.cjs');
  assert.equal(fs.existsSync(sourcePath), true, 'theme-smoke.cjs must exist');
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const needle of [
    "page.$('.cq-page')",
    "miniProgram.on('exception'",
    'route-results.json',
    'miniProgram.screenshot',
    'buildThemeRoutes',
  ]) {
    assert.equal(source.includes(needle), true, 'theme smoke must contain ' + needle);
  }
});

test('container runner dispatches the requested theme suite', () => {
  const source = fs.readFileSync(path.join(__dirname, 'container-runner.cjs'), 'utf8');
  assert.match(source, /--suite/);
  assert.match(source, /theme-smoke\.cjs/);
});
