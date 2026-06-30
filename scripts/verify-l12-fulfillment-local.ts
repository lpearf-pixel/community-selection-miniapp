import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l12-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function post(url: string, payload: unknown) {
  return json(await app.inject({ method: 'POST', url, payload }));
}

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-cat` } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'community address' } });
  const store = await prisma.pickupStore.create({ data: { name: `${prefix}-store`, address: 'store address', phone: '13800000000' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L12开团人', role: 'leader' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L12用户', role: 'customer' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 1200, cost_price_cents: 800, stock: 100, unit: '份', is_group_enabled: true, status: 'active', commission_type: 'fixed', commission_value: 100 } });
  const groupBuy = await post('/api/group-buys', { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, end_time: new Date(Date.now() + 3600_000).toISOString(), pickup_time: new Date(Date.now() + 7200_000).toISOString() });
  const order = await post('/api/orders', { user_id: user.id, group_buy_id: groupBuy.id, client_request_id: `${prefix}-order`, quantity: 2, pickup_store_id: store.id, receiver_name: '张三', receiver_phone: '13812345678' });
  await post('/api/payments/mock', { order_id: order.id });
  await post(`/api/orders/${order.id}/status`, { next_status: 'ready' });

  const overview = await json(await app.inject({ method: 'GET', url: '/api/admin/fulfillment/overview' }));
  assert(overview.by_community.some((item: any) => item.community_id === community.id && item.quantity >= 2), 'overview should include community quantity');
  assert(overview.by_product.some((item: any) => item.product_id === product.id && item.quantity >= 2), 'overview should include product quantity');

  const detailCsv = await app.inject({ method: 'GET', url: '/api/orders/export/picking.csv?format=detail' });
  assert(detailCsv.statusCode === 200, 'detail csv should export');
  assert(detailCsv.body.includes(order.order_no), 'detail csv should include order_no');
  assert(detailCsv.body.includes('138****5678'), 'detail csv should mask phone');
  assert(!detailCsv.body.includes('13812345678'), 'detail csv should not include full phone');
  const summaryCsv = await app.inject({ method: 'GET', url: '/api/orders/export/picking.csv?format=summary' });
  assert(summaryCsv.statusCode === 200 && summaryCsv.body.includes('total_quantity'), 'summary csv should export quantity summary');

  const picked = await post(`/api/admin/orders/${order.id}/pickup-verify`, { admin_remark: '用户已自提' });
  assert(picked.order_status === 'picked', 'ready order should become picked');
  const pickedAgain = await post(`/api/admin/orders/${order.id}/pickup-verify`, { admin_remark: '重复核销' });
  assert(pickedAgain.order_status === 'picked', 'picked order should be idempotent');
  const closedOrder = await prisma.order.create({ data: { order_no: `${prefix}-closed`, user_id: user.id, leader_user_id: leader.id, group_buy_id: groupBuy.id, total_amount_cents: 100, pay_amount_cents: 100, quantity: 1, receiver_name: '李四', receiver_phone: '13912345678', order_status: 'closed', pay_status: 'closed' } });
  const closedVerify = await app.inject({ method: 'POST', url: `/api/admin/orders/${closedOrder.id}/pickup-verify`, payload: { admin_remark: '不可核销' } });
  assert(closedVerify.statusCode === 400, 'closed order should not pickup-verify');

  const [timeline, businessEvent, auditLog] = await Promise.all([
    prisma.orderTimelineLog.findFirst({ where: { order_id: order.id, event_type: 'pickup_verified' } }),
    prisma.businessEventLog.findFirst({ where: { order_id: order.id, event_type: 'pickup_verified' } }),
    prisma.adminAuditLog.findFirst({ where: { target_id: order.id, action: 'order_pickup_verified' } })
  ]);
  assert(timeline && businessEvent && auditLog, 'pickup verify should write timeline, business event and admin audit');

  const dashboard = await json(await app.inject({ method: 'GET', url: `/api/leaders/me/dashboard?leader_user_id=${leader.id}` }));
  assert(dashboard.total_orders >= 1 && dashboard.total_amount_cents >= 0, 'leader dashboard should aggregate orders and amount');
  assert('available_commission_cents' in dashboard && 'converted_credit_cents' in dashboard, 'leader dashboard should include commission fields');

  const cloned = await post(`/api/group-buys/${groupBuy.id}/clone`, { end_time: new Date(Date.now() + 86_400_000).toISOString(), pickup_time: new Date(Date.now() + 172_800_000).toISOString() });
  assert(cloned.id !== groupBuy.id && cloned.status === 'pending', 'clone should create a new pending group buy');
  const clonedWithOrders = await prisma.groupBuy.findUnique({ where: { id: cloned.id }, include: { orders: true } });
  assert(clonedWithOrders?.orders.length === 0, 'clone should not copy orders');

  const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(compliance.status === 0, 'compliance scan should pass');

  console.log('L12 fulfillment verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
