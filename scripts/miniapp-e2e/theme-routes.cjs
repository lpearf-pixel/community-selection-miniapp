const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/miniapp/app.json'), 'utf8'));

function encoded(value, fallback) {
  return encodeURIComponent(String(value || fallback));
}

function buildThemeRoutes(fixtures = {}) {
  const queryByPath = {
    'pages/product-detail/index': '?id=' + encoded(fixtures.productId, 'e2e-missing-product'),
    'pages/group-buy-detail/index': '?id=' + encoded(fixtures.groupBuyId, 'e2e-missing-group'),
    'pages/join-order/index': '?group_buy_id=' + encoded(fixtures.groupBuyId, 'e2e-missing-group'),
    'pages/orders/confirm/index': '?type=normal&product_id=' + encoded(fixtures.productId, 'e2e-missing-product'),
    'pages/orders/detail/index': '?id=' + encoded(fixtures.orderId, 'e2e-missing-order'),
    'pages/pickup/code/index': '?id=' + encoded(fixtures.orderId, 'e2e-missing-order'),
    'pages/after-sales/apply/index': '?order_id=' + encoded(fixtures.orderId, 'e2e-missing-order'),
    'pages/after-sales/detail/index': '?order_id=' + encoded(fixtures.orderId, 'e2e-missing-order'),
  };
  return app.pages.map((routePath, index) => ({
    path: routePath,
    query: queryByPath[routePath] || '',
    role: routePath.startsWith('pages/leader/') ? 'leader' : 'customer',
    screenshot: String(index + 1).padStart(2, '0') + '-' + routePath.replaceAll('/', '-') + '.png',
  }));
}

module.exports = { buildThemeRoutes };
