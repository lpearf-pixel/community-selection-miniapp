import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l19-${Date.now()}`;

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

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1900, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L19 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup-store`, address: 'L19 自提点', phone: '13800019000', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L19开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L19用户', role: 'customer', status: 'active' } });
  const otherUser = await prisma.user.create({ data: { openid: `${prefix}-other-openid`, nickname: 'L19其他用户', role: 'customer', status: 'active' } });
  const activeProduct = await prisma.product.create({ data: { name: `${prefix}-active-product`, category_id: category.id, cover_image: '/images/l19.png', images: ['/images/l19-a.png'], description: 'L19 商品详情验收', price_cents: 1990, cost_price_cents: 800, stock: 80, unit: '份', stock_unit: '份', sale_unit: '份', sale_spec_name: '1份装', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const inactiveProduct = await prisma.product.create({ data: { name: `${prefix}-inactive-product`, category_id: category.id, price_cents: 990, cost_price_cents: 300, stock: 10, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'none', commission_value: 0, status: 'inactive' } });
  const soldOutProduct = await prisma.product.create({ data: { name: `${prefix}-sold-out-product`, category_id: category.id, price_cents: 1290, cost_price_cents: 500, stock: 0, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, is_group_enabled: false, commission_type: 'none', commission_value: 0, status: 'active' } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: activeProduct.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 1790, start_time: new Date(), end_time: new Date(Date.now() + 24 * 60 * 60 * 1000), pickup_time: new Date(Date.now() + 48 * 60 * 60 * 1000), status: 'pending' } });

  const products = await data(await app.inject({ method: 'GET', url: `/api/products?keyword=${encodeURIComponent(prefix)}&page_size=100` }));
  assert(products.items.some((item: any) => item.product_id === activeProduct.id), 'product list should include active product');
  assert(!products.items.some((item: any) => item.product_id === inactiveProduct.id), 'product list should not include inactive product');
  const activeItem = products.items.find((item: any) => item.product_id === activeProduct.id);
  assert(activeItem.has_active_group_buy === true, 'active product should show active group buy');
  assert(activeItem.active_group_buy_count >= 1, 'active product should count active group buys');
  assertNoInternalFields(products, 'product list');

  const inStockProducts = await data(await app.inject({ method: 'GET', url: `/api/products?keyword=${encodeURIComponent(prefix)}&only_in_stock=true&page_size=100` }));
  assert(inStockProducts.items.every((item: any) => item.stock > 0), 'only_in_stock should only return stocked products');
  assert(!inStockProducts.items.some((item: any) => item.product_id === soldOutProduct.id), 'only_in_stock should exclude sold out active product');

  const detail = await data(await app.inject({ method: 'GET', url: `/api/products/${activeProduct.id}` }));
  assert(detail.product_id === activeProduct.id && detail.name === activeProduct.name, 'detail should return active product');
  assert(detail.active_group_buys.some((item: any) => item.group_buy_id === groupBuy.id), 'detail should include test group buy');
  assert(detail.can_normal_buy === true, 'detail should allow normal buy');
  assert(detail.can_join_group_buy === true, 'detail should allow joining group buy');
  assertNoInternalFields(detail, 'product detail');

  const groupBuys = await data(await app.inject({ method: 'GET', url: `/api/products/${activeProduct.id}/group-buys?community_id=${community.id}` }));
  const listedGroupBuy = groupBuys.items.find((item: any) => item.group_buy_id === groupBuy.id);
  assert(listedGroupBuy, 'product group buy list should include test group buy');
  assert(new Date(listedGroupBuy.end_time).getTime() > Date.now(), 'group buy end time should be in the future');
  assert(listedGroupBuy.community_id === community.id && listedGroupBuy.community_name === community.name, 'group buy community should match');

  const normalOrder = await data(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: activeProduct.id, user_id: customer.id, client_request_id: `${prefix}-normal`, quantity: 2, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L19普通用户', receiver_phone: '13812345678' } }));
  await data(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));
  const normalDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(normalDetail.order_type === 'normal', 'normal order detail should be normal type');
  assert(normalDetail.product.name === activeProduct.name, 'normal order product name should match');
  assert(await prisma.commission.count({ where: { order_id: normalOrder.id } }) === 0, 'normal order should not create service reward');

  const groupOrder = await data(await app.inject({ method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, user_id: customer.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L19开团用户', receiver_phone: '13912345678' } }));
  await data(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  const groupDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${groupOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(groupDetail.order_type === 'group_buy', 'group order detail should be group buy type');
  assert(groupDetail.group_buy?.group_buy_id === groupBuy.id, 'group order detail should include group buy');
  assert(groupDetail.product.name === activeProduct.name, 'group order product name should match');

  const publicResponse = await app.inject({ method: 'GET', url: `/api/products/${activeProduct.id}` });
  assert(publicResponse.statusCode === 200, 'product API should be public');
  const missingIdentity = await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}` });
  assert(missingIdentity.statusCode === 401, 'user order detail should require identity');
  const forbiddenDetail = await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': otherUser.id } });
  assert([403, 404].includes(forbiddenDetail.statusCode), 'another user should not read order detail');

  scanComplianceFiles([
    'apps/api/src/modules/user-products/user-product-service.ts',
    'apps/api/src/routes/public/products.ts',
    'apps/api/src/routes/public/index.ts',
    'scripts/verify-l19-product-purchase-entry-local.ts',
    'docs/reviews/l19-product-purchase-entry.md',
    'apps/miniapp/app.json',
    'apps/miniapp/pages/products/index.js',
    'apps/miniapp/pages/products/index.wxml',
    'apps/miniapp/pages/product-detail/index.js',
    'apps/miniapp/pages/product-detail/index.wxml',
    'apps/miniapp/pages/orders/confirm/index.js',
    'apps/miniapp/pages/orders/confirm/index.wxml'
  ]);
  console.log('Compliance scan passed.');
  console.log('L19 product purchase entry verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
