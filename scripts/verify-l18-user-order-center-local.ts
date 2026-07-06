import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';

process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l18-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(response.statusCode < 300 && body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1800, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L18 验收社区', status: 'active' } });
  const pickupStore = await prisma.pickupStore.create({ data: { name: `${prefix}-pickup-store`, address: 'L18 自提点', phone: '13800018000', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-openid`, nickname: 'L18用户', role: 'customer', status: 'active' } });
  const otherUser = await prisma.user.create({ data: { openid: `${prefix}-other-openid`, nickname: 'L18其他用户', role: 'customer', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L18开团人', role: 'leader', status: 'active' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 1880, cost_price_cents: 900, stock: 50, unit: '份', stock_unit: 'piece', sale_unit: '份', sale_spec_name: '1份装', stock_deduct_quantity: 1, is_group_enabled: true, commission_type: 'percent', commission_value: 5, status: 'active' } });

  const normalOrder = await json(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: user.id, client_request_id: `${prefix}-normal`, quantity: 2, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: '普通用户', receiver_phone: '13812340000' } }));
  await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: normalOrder.id } }));
  assert((await prisma.order.findUniqueOrThrow({ where: { id: normalOrder.id } })).user_id === user.id, 'normal order should belong to user');

  const groupBuy = await json(await app.inject({ method: 'POST', url: '/api/group-buys', payload: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 2, min_quantity: 2 } }));
  const groupOrder = await json(await app.inject({ method: 'POST', url: '/api/orders', payload: { group_buy_id: groupBuy.id, user_id: user.id, client_request_id: `${prefix}-group`, quantity: 1, pickup_store_id: pickupStore.id, community_id: community.id, receiver_name: '开团用户', receiver_phone: '13912340000' } }));
  await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: groupOrder.id } }));
  assert((await prisma.order.findUniqueOrThrow({ where: { id: groupOrder.id } })).user_id === user.id, 'group order should belong to user');

  const list = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=all&page_size=100', headers: { 'x-user-id': user.id } }));
  assert(list.items.some((item: any) => item.order_id === normalOrder.id && item.order_type === 'normal' && item.product_name === product.name && item.after_sale_case_count === 0), 'user order list should include normal order');
  assert(list.items.some((item: any) => item.order_id === groupOrder.id && item.order_type === 'group_buy' && item.product_name === product.name), 'user order list should include group order');
  const normalList = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=normal&page_size=100', headers: { 'x-openid': user.openid } }));
  assert(normalList.items.every((item: any) => item.order_type === 'normal') && normalList.items.some((item: any) => item.order_id === normalOrder.id), 'type normal filter failed');
  const groupList = await json(await app.inject({ method: 'GET', url: '/api/me/orders?type=group_buy&page_size=100', headers: { 'x-user-id': user.id } }));
  assert(groupList.items.every((item: any) => item.order_type === 'group_buy') && groupList.items.some((item: any) => item.order_id === groupOrder.id), 'type group filter failed');

  const normalDetail = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': user.id } }));
  const groupDetail = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${groupOrder.id}`, headers: { 'x-user-id': user.id } }));
  assert(normalDetail.group_buy === null && normalDetail.product.name === product.name && normalDetail.pickup.pickup_code, 'normal detail should include product and no group buy');
  assert(groupDetail.group_buy?.group_buy_id === groupBuy.id && groupDetail.product.name === product.name && groupDetail.pickup, 'group detail should include group buy and pickup');
  const forbiddenDetail = await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': otherUser.id } });
  assert([403, 404].includes(forbiddenDetail.statusCode), 'other user should not read order detail');

  const afterSale = await json(await app.inject({ method: 'POST', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': user.id }, payload: { type: 'bad_quality', reason: '品质问题', description: 'L18 用户售后入口', requested_refund_cents: 100 } }));
  assert(afterSale.status === 'submitted', 'after sale should be submitted');
  const afterSales = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/after-sales`, headers: { 'x-user-id': user.id } }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'after sale list should include submitted case');
  const detailAfterSale = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}`, headers: { 'x-user-id': user.id } }));
  assert(detailAfterSale.after_sale_case_count >= 1, 'detail should show after sale count');

  const pickup = await json(await app.inject({ method: 'GET', url: `/api/me/orders/${normalOrder.id}/pickup-code`, headers: { 'x-user-id': user.id } }));
  assert(pickup.pickup_code.startsWith('PICK-'), 'pickup code should start with PICK-');
  assert(pickup.receiver_phone_masked !== '13812340000' && !pickup.receiver_phone_masked.includes('1234'), 'pickup phone should be masked');
  const unpaidOrder = await json(await app.inject({ method: 'POST', url: '/api/orders/normal', payload: { product_id: product.id, user_id: user.id, client_request_id: `${prefix}-unpaid`, quantity: 1, receiver_name: '未支付用户', receiver_phone: '13712340000' } }));
  const unpaidPickup = await app.inject({ method: 'GET', url: `/api/me/orders/${unpaidOrder.id}/pickup-code`, headers: { 'x-user-id': user.id } });
  assert(unpaidPickup.statusCode >= 400, 'unpaid order should not expose pickup code');
  assert(await prisma.commission.count({ where: { order_id: normalOrder.id } }) === 0, 'normal order should not create service reward');

  const files = [
    'apps/api/src/modules/user-orders/user-order-service.ts',
    'apps/api/src/routes/me/orders.ts',
    'scripts/verify-l18-user-order-center-local.ts',
    'docs/reviews/l18-user-order-center.md'
  ];
  const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
  const forbidden = [`parent_${'leader'}_id`, `up${'line'}_id`, `down${'line'}`, `team_${'id'}`, `le${'vel'} ${'commission'}`, `多级${'分'}销`, `团队${'收益'}`, `代理${'收益'}`, `优${'惠'}券`, `会${'员'}`, `裂${'变'}`, `AUTO_PAYOUT_ENABLED = ${'true'}`, `AUTO_TAX_FILING_ENABLED = ${'true'}`];
  for (const term of forbidden) assert(!source.includes(term), `forbidden term found: ${term}`);
  console.log('Compliance scan passed.');
  console.log('L18 user order center verification passed.');
}

main().finally(async () => { await app.close(); await prisma.$disconnect(); });
