import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l20-${Date.now()}`;

const miniappFiles = [
  'apps/miniapp/utils/api.js',
  'apps/miniapp/utils/user.js',
  'apps/miniapp/app.js',
  'apps/miniapp/app.json',
  'apps/miniapp/pages/join-order/index.js',
  'apps/miniapp/pages/products/index.js',
  'apps/miniapp/pages/products/index.wxml',
  'apps/miniapp/pages/product-detail/index.js',
  'apps/miniapp/pages/product-detail/index.wxml',
  'apps/miniapp/pages/orders/confirm/index.js',
  'apps/miniapp/pages/orders/confirm/index.wxml',
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

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function data(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}
function assertNoInternalFields(payload: unknown, label: string) {
  const text = JSON.stringify(payload);
  assert(!text.includes('cost_price_cents'), `${label} should not expose cost price`);
  assert(!text.includes('commission_value'), `${label} should not expose reward config`);
  assert(!text.includes('stock_deduct_quantity'), `${label} should not expose stock deduction rule`);
}

async function verifyBackendFlow() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 2000, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L20 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup-store`, address: 'L20 自提点', phone: '13800020000', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L20开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L20用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, cover_image: '/images/l20.png', images: ['/images/l20-a.png'], description: 'L20 商品端到端验收', price_cents: 2090, cost_price_cents: 900, stock: 100, unit: '份', stock_unit: '份', sale_unit: '份', sale_spec_name: '1份装', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 1890, start_time: new Date(), end_time: new Date(Date.now() + 24 * 60 * 60 * 1000), pickup_time: new Date(Date.now() + 48 * 60 * 60 * 1000), status: 'pending' } });

  const products = await data(await app.inject({ method: 'GET', url: `/api/products?keyword=${encodeURIComponent(prefix)}&page_size=100` }));
  assert(products.items.some((item: any) => item.product_id === product.id), 'products should include L20 product');
  assertNoInternalFields(products, 'product list');

  const productDetail = await data(await app.inject({ method: 'GET', url: `/api/products/${product.id}` }));
  assert(productDetail.product_id === product.id, 'product detail should match product');
  assert(productDetail.active_group_buys.some((item: any) => item.group_buy_id === groupBuy.id), 'product detail should include active group buy');
  assertNoInternalFields(productDetail, 'product detail');

  const groupBuys = await data(await app.inject({ method: 'GET', url: `/api/products/${product.id}/group-buys?community_id=${community.id}` }));
  assert(groupBuys.items.some((item: any) => item.group_buy_id === groupBuy.id), 'group buy list should include active group buy');

  const normalOrder = await data(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: customer.id, client_request_id: `${prefix}-normal`, quantity: 2, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L20普通用户', receiver_phone: '13812345678' } }));
  await data(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));
  const normalDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(normalDetail.order_type === 'normal', 'normal order detail should be normal');
  const pickupCode = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/pickup-code`, headers: { 'x-user-id': customer.id } }));
  assert(pickupCode.pickup_code && pickupCode.receiver_phone_masked, 'pickup code should include masked receiver phone');
  const afterSale = await data(await app.inject({ method: 'POST', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': customer.id }, payload: { type: 'bad_quality', reason: 'L20 售后验收', description: '小程序端到端售后申请', requested_refund_cents: 100 } }));
  assert(afterSale.status === 'submitted', 'after sale should be submitted');
  const afterSales = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': customer.id } }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'after sale list should include submitted case');

  const groupOrder = await data(await app.inject({ method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, user_id: customer.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L20开团用户', receiver_phone: '13912345678' } }));
  await data(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  const groupDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${groupOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(groupDetail.order_type === 'group_buy', 'group order detail should be group buy');
}

function verifyMiniappFiles() {
  for (const file of miniappFiles) assert(existsSync(file), `${file} should exist`);
  const appConfig = JSON.parse(readFileSync('apps/miniapp/app.json', 'utf8'));
  for (const page of requiredPages) assert(appConfig.pages.includes(page), `app.json should include ${page}`);
}

function listMiniappSourceFiles(dir = 'apps/miniapp'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listMiniappSourceFiles(fullPath);
    return /\.(js|wxml|json|wxss)$/.test(fullPath) ? [fullPath] : [];
  });
}

function verifyMiniappSource() {
  const source = listMiniappSourceFiles().map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const needle of ['/api/products', '/api/orders/normal', '/api/orders', '/api/payments/mock', '/api/me/orders', '/pickup-code', '/after-sales']) {
    assert(source.includes(needle), `miniapp source should include ${needle}`);
  }
  for (const blocked of ['wx.requestPayment', 'requestPayment', '/api/payments/wechat', 'wx.login', 'cost_price_cents', 'commission_value', 'stock_deduct_quantity']) {
    assert(!source.includes(blocked), `miniapp source should not include ${blocked}`);
  }
  assert(!/1[3-9]\d{9}/.test(source), 'miniapp source should not hardcode full mobile numbers');
  assert(source.includes('receiver_phone_masked'), 'miniapp source should use masked receiver phone field');
}

async function main() {
  await verifyBackendFlow();
  verifyMiniappFiles();
  verifyMiniappSource();
  scanComplianceFiles([...miniappFiles, 'scripts/verify-l20-miniapp-e2e-release-local.ts', 'docs/reviews/l20-miniapp-e2e-release.md']);
  console.log('Compliance scan passed.');
  console.log('L20 miniapp e2e release verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
