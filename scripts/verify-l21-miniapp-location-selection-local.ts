import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';
import {
  enableConsumerVerifierMockIdentity,
  injectAsConsumer,
} from './lib/consumer-verifier-request.js';

enableConsumerVerifierMockIdentity();
process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l21-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function data(response: Awaited<ReturnType<typeof app.inject>>) { const body = response.json() as { success: boolean; data: any; message: string }; assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`); return body.data; }
function noInternal(payload: unknown, label: string) { const text = JSON.stringify(payload); for (const field of ['created_at','updated_at','latitude','longitude','cost_price_cents','commission_value','stock_deduct_quantity']) assert(!text.includes(field), `${label} exposed ${field}`); }
function source(path: string) { return readFileSync(path, 'utf8'); }

async function main() {
  const community = await prisma.community.create({ data: { name: `${prefix}-active-community`, address: 'L21 活跃社区', status: 'active' } });
  const inactiveCommunity = await prisma.community.create({ data: { name: `${prefix}-inactive-community`, address: 'L21 停用社区', status: 'inactive' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-active-pickup`, address: 'L21 活跃自提点', phone: '13800021000', status: 'active' } });
  const inactiveStore = await prisma.pickupStore.create({ data: { name: `${prefix}-inactive-pickup`, address: 'L21 停用自提点', phone: '13800021999', status: 'inactive' } });
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 2100, status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 2100, cost_price_cents: 900, stock: 50, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L21开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L21用户', role: 'customer', status: 'active' } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 1990, start_time: new Date(), end_time: new Date(Date.now() + 86400000), pickup_time: new Date(Date.now() + 172800000), status: 'pending' } });

  const communities = await data(await app.inject({ method: 'GET', url: `/api/communities?keyword=${encodeURIComponent(prefix)}&page_size=100` }));
  assert(communities.items.some((item: any) => item.community_id === community.id), 'active community should be listed');
  assert(!communities.items.some((item: any) => item.community_id === inactiveCommunity.id), 'inactive community should not be listed');
  noInternal(communities, 'communities');

  const stores = await data(await app.inject({ method: 'GET', url: `/api/pickup-stores?keyword=${encodeURIComponent(prefix)}&community_id=${community.id}&page_size=100` }));
  assert(stores.items.some((item: any) => item.pickup_store_id === pickupStore.id), 'active pickup store should be listed');
  assert(!stores.items.some((item: any) => item.pickup_store_id === inactiveStore.id), 'inactive pickup store should not be listed');
  noInternal(stores, 'pickup stores');
  const storeDetail = await data(await app.inject({ method: 'GET', url: `/api/pickup-stores/${pickupStore.id}` }));
  assert(storeDetail.pickup_store_id === pickupStore.id, 'active pickup detail should load');
  assert((await app.inject({ method: 'GET', url: `/api/pickup-stores/${inactiveStore.id}` })).statusCode === 404, 'inactive pickup detail should fail');

  const normalOrder = await data(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, client_request_id: `${prefix}-normal`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L21用户', receiver_phone: '13812345678' } }));
  await data(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));
  const normalDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(normalDetail.pickup.pickup_store_name === pickupStore.name, 'normal order should include pickup info');
  assert(normalDetail.receiver.receiver_phone_masked, 'normal order should include masked phone');

  const groupOrder = await data(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L21团购用户', receiver_phone: '13912345678' } }));
  await data(await injectAsConsumer(app, customer.id, { method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  const groupDetail = await data(await app.inject({ method: 'GET', url: `/api/me/orders/${groupOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(groupDetail.order_type === 'group_buy', 'group order detail should be group_buy');

  const requiredFiles = ['apps/miniapp/utils/selection.js','apps/miniapp/pages/communities/index.js','apps/miniapp/pages/communities/index.wxml','apps/miniapp/pages/pickup/select/index.js','apps/miniapp/pages/pickup/select/index.wxml','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/confirm/index.wxml'];
  requiredFiles.forEach((file) => assert(existsSync(file), `${file} should exist`));
  const appJson = source('apps/miniapp/app.json');
  assert(appJson.includes('pages/communities/index') && appJson.includes('pages/pickup/select/index'), 'app.json should include L21 pages');
  const miniappSource = ['apps/miniapp/utils/api.js','apps/miniapp/utils/user.js','apps/miniapp/utils/selection.js','apps/miniapp/pages/communities/index.js','apps/miniapp/pages/pickup/select/index.js','apps/miniapp/pages/products/index.js','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/confirm/index.wxml','apps/miniapp/pages/orders/detail/index.js'].map(source).join('\n');
  for (const needle of ['/api/communities','/api/pickup-stores','selected_community','selected_pickup_store','/api/orders/normal','/api/orders','/api/payments/mock']) assert(miniappSource.includes(needle), `miniapp source should include ${needle}`);
  for (const needle of ['wx.requestPayment','/api/payments/wechat','wx.login','wx.getLocation','cost_price_cents','commission_value','stock_deduct_quantity']) assert(!miniappSource.includes(needle), `miniapp source should not include ${needle}`);
  assert(miniappSource.includes('receiver_phone_masked') || miniappSource.includes('masked'), 'miniapp should use masked phone field');

  scanComplianceFiles(['apps/api/src/modules/user-locations/user-location-service.ts','apps/api/src/routes/catalog.ts','apps/api/src/routes/public/locations.ts','apps/api/src/routes/public/index.ts','apps/miniapp/utils/selection.js','apps/miniapp/pages/communities/index.js','apps/miniapp/pages/communities/index.wxml','apps/miniapp/pages/pickup/select/index.js','apps/miniapp/pages/pickup/select/index.wxml','apps/miniapp/pages/products/index.js','apps/miniapp/pages/products/index.wxml','apps/miniapp/pages/product-detail/index.js','apps/miniapp/pages/product-detail/index.wxml','apps/miniapp/pages/orders/confirm/index.js','apps/miniapp/pages/orders/confirm/index.wxml','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','scripts/verify-l21-miniapp-location-selection-local.ts','docs/reviews/l21-miniapp-location-selection.md']);
  console.log('Compliance scan passed.');
  console.log('L21 miniapp location selection verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
