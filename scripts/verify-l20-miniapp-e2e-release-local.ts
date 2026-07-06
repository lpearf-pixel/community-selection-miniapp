import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/db.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const repoRoot = process.cwd();
const app = buildApp();
const prefix = `l20-${Date.now()}`;

const requiredFiles = [
  'apps/miniapp/utils/api.js',
  'apps/miniapp/utils/user.js',
  'apps/miniapp/app.js',
  'apps/miniapp/app.json',
  'apps/miniapp/pages/products/index.js',
  'apps/miniapp/pages/products/index.wxml',
  'apps/miniapp/pages/product-detail/index.js',
  'apps/miniapp/pages/product-detail/index.wxml',
  'apps/miniapp/pages/orders/confirm/index.js',
  'apps/miniapp/pages/orders/detail/index.js',
  'apps/miniapp/pages/orders/detail/index.wxml',
  'apps/miniapp/pages/pickup/code/index.js',
  'apps/miniapp/pages/pickup/code/index.wxml',
  'apps/miniapp/pages/after-sales/apply/index.js',
  'apps/miniapp/pages/after-sales/apply/index.wxml',
  'apps/miniapp/pages/after-sales/detail/index.js',
  'apps/miniapp/pages/after-sales/detail/index.wxml'
];
const requiredPages = [
  'pages/products/index',
  'pages/product-detail/index',
  'pages/orders/confirm/index',
  'pages/orders/detail/index',
  'pages/pickup/code/index',
  'pages/after-sales/apply/index',
  'pages/after-sales/detail/index'
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function read(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

async function data(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

function runMiniappStaticChecks() {
  for (const file of requiredFiles) assert(existsSync(join(repoRoot, file)), `${file} should exist`);
  const appJson = JSON.parse(read('apps/miniapp/app.json')) as { pages: string[] };
  for (const page of requiredPages) assert(appJson.pages.includes(page), `${page} should be registered`);

  const source = requiredFiles.filter((file) => /\.(js|wxml|json)$/.test(file)).map(read).join('\n');
  assert(source.includes('/api/products'), 'miniapp source should include product APIs');
  assert(source.includes('/api/orders/normal'), 'miniapp source should include normal order API');
  assert(source.includes('/api/orders'), 'miniapp source should include group order API');
  assert(source.includes('/api/payments/mock'), 'miniapp source should include mock payment API');
  assert(source.includes('/api/me/orders'), 'miniapp source should include user order APIs');
  assert(source.includes('/pickup-code'), 'miniapp source should include pickup code API');
  assert(source.includes('/after-sales'), 'miniapp source should include after-sales APIs');
  assert(source.includes('receiver_phone_masked'), 'miniapp source should display masked receiver phone for pickup');
  assert(!source.includes('wx.requestPayment'), 'miniapp source must not call wx.requestPayment');
  assert(!source.includes('/api/payments/wechat'), 'miniapp source must not connect real WeChat payment');
  assert(!source.includes('wx.login'), 'miniapp source must not depend on wx.login for L20 local e2e');
  assert(!source.includes('cost_price_cents'), 'miniapp source must not expose cost price');
  assert(!source.includes('commission_value'), 'miniapp source must not expose reward config');
  assert(!source.includes('stock_deduct_quantity'), 'miniapp source must not expose stock deduction internals');
}

async function runBackendE2E() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 2000, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L20 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup-store`, address: 'L20 自提点', phone: '13800020000', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L20开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L20用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, cover_image: '/images/l20.png', images: ['/images/l20-a.png'], description: 'L20 小程序端端到端联调商品', price_cents: 2190, cost_price_cents: 900, stock: 100, unit: '份', stock_unit: '份', sale_unit: '份', sale_spec_name: '1份装', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 1990, start_time: new Date(), end_time: new Date(Date.now() + 24 * 60 * 60 * 1000), pickup_time: new Date(Date.now() + 48 * 60 * 60 * 1000), status: 'pending' } });

  const products = await data(await app.inject({ method: 'GET', url: `/api/products?keyword=${encodeURIComponent(prefix)}&page_size=100` }));
  assert(products.items.some((item: any) => item.product_id === product.id), 'GET /api/products should include seeded product');

  const detail = await data(await app.inject({ method: 'GET', url: `/api/products/${product.id}` }));
  assert(detail.product_id === product.id, 'GET /api/products/:id should return seeded product');
  assert(detail.active_group_buys.some((item: any) => item.group_buy_id === groupBuy.id), 'product detail should include active group buy');

  const groupBuys = await data(await app.inject({ method: 'GET', url: `/api/products/${product.id}/group-buys?community_id=${community.id}` }));
  assert(groupBuys.items.some((item: any) => item.group_buy_id === groupBuy.id), 'GET /api/products/:id/group-buys should include seeded group buy');

  const normalOrder = await data(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: customer.id, client_request_id: `${prefix}-normal`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L20普通购买用户', receiver_phone: '13812345678' } }));
  await data(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));

  const userHeaders = { 'x-user-id': customer.id };
  const normalDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: userHeaders }));
  assert(normalDetail.order_type === 'normal', 'normal order detail should have order_type = normal');

  const pickupCode = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/pickup-code`, headers: userHeaders }));
  assert(pickupCode.receiver_phone_masked === '138****5678', 'pickup code should return masked receiver phone');

  const afterSale = await data(await app.inject({ method: 'POST', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: userHeaders, payload: { type: 'bad_quality', reason: 'L20 验收售后', requested_refund_cents: 500 } }));
  assert(afterSale.id, 'POST /api/me/orders/:id/after-sales should create after-sale case');

  const afterSales = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: userHeaders }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'GET /api/me/orders/:id/after-sales should list created case');

  const groupOrder = await data(await app.inject({ method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, user_id: customer.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L20团购用户', receiver_phone: '13912345678' } }));
  await data(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  const groupDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${groupOrder.id}`, headers: userHeaders }));
  assert(groupDetail.order_type === 'group_buy', 'group order detail should have order_type = group_buy');
}

async function main() {
  runMiniappStaticChecks();
  await runBackendE2E();
  scanComplianceFiles([...requiredFiles, 'scripts/verify-l20-miniapp-e2e-release-local.ts', 'docs/reviews/l20-miniapp-e2e-release.md']);
  console.log('Compliance scan passed.');
  console.log('L20 miniapp e2e release verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
