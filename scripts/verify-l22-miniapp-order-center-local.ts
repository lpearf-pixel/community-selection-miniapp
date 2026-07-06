import { existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { scanComplianceFiles } from './lib/compliance-scan.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l22-${Date.now()}`;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function json(response: Awaited<ReturnType<typeof app.inject>>) { const body = response.json() as { success: boolean; data: any; message: string }; assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`); return body.data; }
function source(path: string) { return readFileSync(path, 'utf8'); }
function assertNotExposed(payload: unknown, label: string) { const text = JSON.stringify(payload); for (const field of ['cost_price_cents','commission_value','stock_deduct_quantity']) assert(!text.includes(field), `${label} exposed ${field}`); for (const phone of ['13812342222','13912342222','13712342222']) assert(!text.includes(phone), `${label} exposed full receiver phone`); }

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 2200, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L22 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup`, address: 'L22 自提点', phone: '13800022000', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L22开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L22用户', role: 'customer', status: 'active' } });
  const other = await prisma.user.create({ data: { openid: `${prefix}-other-openid`, nickname: 'L22其他用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 2200, cost_price_cents: 900, stock: 80, unit: '份', stock_unit: '份', sale_unit: '份', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2, current_people: 0, current_quantity: 0, price_cents: 1990, start_time: new Date(), end_time: new Date(Date.now() + 86400000), pickup_time: new Date(Date.now() + 172800000), status: 'pending' } });

  const normalOrder = await json(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: customer.id, client_request_id: `${prefix}-normal`, quantity: 2, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L22普通用户', receiver_phone: '13812342222' } }));
  await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));
  const groupOrder = await json(await app.inject({ method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, user_id: customer.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: 'L22开团用户', receiver_phone: '13912342222' } }));
  await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  const otherOrder = await json(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: other.id, client_request_id: `${prefix}-other`, quantity: 1, receiver_name: 'L22其他用户', receiver_phone: '13712342222' } }));

  const list = await json(await app.inject({ method: 'GET', url: '/api/me/orders?page_size=100', headers: { 'x-user-id': customer.id } }));
  assert(list.items.some((item: any) => item.order_id === normalOrder.id && item.order_type === 'normal'), 'list should include normal order');
  assert(list.items.some((item: any) => item.order_id === groupOrder.id && item.order_type === 'group_buy'), 'list should include group order');
  assert(!list.items.some((item: any) => item.order_id === otherOrder.id), 'list should not include other user order');
  assertNotExposed(list, 'order list');
  const normals = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=normal&page_size=100', headers: { 'x-user-id': customer.id } }));
  assert(normals.items.every((item: any) => item.order_type === 'normal'), 'normal filter failed');
  const groups = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=group_buy&page_size=100', headers: { 'x-user-id': customer.id } }));
  assert(groups.items.every((item: any) => item.order_type === 'group_buy'), 'group_buy filter failed');

  const detail = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': customer.id } }));
  assert(detail.product.name === product.name, 'detail product mismatch');
  assert(detail.pickup.pickup_store_name === pickupStore.name, 'detail pickup mismatch');
  assert(detail.receiver.receiver_phone_masked && !detail.receiver.receiver_phone_masked.includes('1234'), 'detail should mask phone');
  assertNotExposed(detail, 'order detail');
  const pickup = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/pickup-code`, headers: { 'x-user-id': customer.id } }));
  assert(pickup.pickup_code && pickup.receiver_phone_masked, 'pickup code should include masked phone');
  assertNotExposed(pickup, 'pickup code');
  const afterSale = await json(await app.inject({ method: 'POST', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': customer.id }, payload: { type: 'bad_quality', reason: '品质问题', requested_refund_cents: 100 } }));
  assert(afterSale.status === 'submitted', 'after sale should submit');
  const afterSales = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': customer.id } }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'after sale list should include new case');

  const requiredFiles = ['apps/miniapp/pages/orders/index.js','apps/miniapp/pages/orders/index.wxml','apps/miniapp/pages/orders/detail/index.js','apps/miniapp/pages/orders/detail/index.wxml','apps/miniapp/pages/pickup/code/index.js','apps/miniapp/pages/pickup/code/index.wxml','apps/miniapp/pages/after-sales/apply/index.js','apps/miniapp/pages/after-sales/apply/index.wxml','apps/miniapp/pages/after-sales/detail/index.js','apps/miniapp/pages/after-sales/detail/index.wxml','apps/miniapp/pages/mine/index.js','apps/miniapp/pages/mine/index.wxml'];
  requiredFiles.forEach((file) => assert(existsSync(file), `${file} should exist`));
  const appJson = source('apps/miniapp/app.json');
  for (const page of ['pages/mine/index','pages/orders/index','pages/orders/detail/index','pages/pickup/code/index','pages/after-sales/apply/index','pages/after-sales/detail/index']) assert(appJson.includes(page), `app.json should include ${page}`);
  const miniappFiles = [...requiredFiles, 'apps/miniapp/app.json', 'apps/miniapp/utils/order.js'];
  const miniappSource = miniappFiles.map(source).join('\n');
  for (const needle of ['/api/me/orders','/pickup-code','/after-sales','bad_quality']) assert(miniappSource.includes(needle), `miniapp source should include ${needle}`);
  assert(miniappSource.includes('receiver_phone_masked') || miniappSource.includes('masked'), 'miniapp source should use masked phone');
  for (const needle of [`type: 'refund'`, `type: "refund"`, 'wx.requestPayment', '/api/payments/wechat', 'wx.login', 'wx.getLocation', 'cost_price_cents', 'commission_value', 'stock_deduct_quantity']) assert(!miniappSource.includes(needle), `miniapp source should not include ${needle}`);

  scanComplianceFiles([...miniappFiles, 'scripts/verify-l22-miniapp-order-center-local.ts', 'docs/reviews/l22-miniapp-order-center.md']);
  console.log('Compliance scan passed.');
  console.log('L22 miniapp order center verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
