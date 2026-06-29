import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { releaseAvailableCommissions } from '../apps/api/src/services/commission-service.js';

const prisma = new PrismaClient();
const app = buildApp();
const stamp = Date.now();
const prefix = `l7-${stamp}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  if (!body.success) throw new Error(`API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function post(url: string, payload: unknown) {
  return json(await app.inject({ method: 'POST', url, payload }));
}

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1200, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L7 本地验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L7 验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L7 用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${prefix}-product`,
      category_id: category.id,
      price_cents: 2000,
      cost_price_cents: 1200,
      stock: 10,
      unit: '份',
      is_group_enabled: true,
      commission_type: 'percent',
      commission_value: 10,
      status: 'active'
    }
  });
  const groupBuy = await post('/api/group-buys', {
    product_id: product.id,
    leader_user_id: leader.id,
    community_id: community.id,
    min_people: 1,
    min_quantity: 1,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });

  const order = await post('/api/orders', {
    user_id: user.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order`,
    quantity: 2,
    receiver_name: 'L7 用户',
    receiver_phone: '13800004001'
  });
  await post('/api/payments/mock', { order_id: order.id });
  await post('/api/payments/mock', { order_id: order.id });
  let commissions = await prisma.commission.findMany({ where: { order_id: order.id } });
  assert(commissions.length === 1, `Repeated payment should create one commission, got ${commissions.length}`);
  assert(commissions[0].status === 'estimated', `Commission should be estimated, got ${commissions[0].status}`);
  assert(commissions[0].final_amount_cents === 400, `Expected 400 commission cents, got ${commissions[0].final_amount_cents}`);

  await post(`/api/orders/${order.id}/status`, { next_status: 'completed' });
  let commission = await prisma.commission.findUniqueOrThrow({ where: { id: commissions[0].id } });
  assert(commission.status === 'pending', `Completed order should move commission pending, got ${commission.status}`);
  assert(commission.available_at !== null, 'Pending commission should have available_at');

  await prisma.commission.update({ where: { id: commission.id }, data: { available_at: new Date(Date.now() - 1000) } });
  await releaseAvailableCommissions();
  commission = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(commission.status === 'available', `Settled commission should become available, got ${commission.status}`);

  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 1000,
    reason: 'L7 本地验收部分退款',
    client_refund_id: `${prefix}-partial-refund`
  });
  commission = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(commission.final_amount_cents === 300, `Partial refund should recalculate commission to 300, got ${commission.final_amount_cents}`);

  const secondOrder = await post('/api/orders', {
    user_id: user.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-full-refund-order`,
    quantity: 1,
    receiver_name: 'L7 用户',
    receiver_phone: '13800004001'
  });
  await post('/api/payments/mock', { order_id: secondOrder.id });
  const secondCommission = await prisma.commission.findFirstOrThrow({ where: { order_id: secondOrder.id } });
  await post('/api/refunds/mock', {
    order_id: secondOrder.id,
    refund_amount_cents: secondOrder.pay_amount_cents,
    reason: 'L7 本地验收全额退款',
    client_refund_id: `${prefix}-full-refund`
  });
  const cancelled = await prisma.commission.findUniqueOrThrow({ where: { id: secondCommission.id } });
  assert(cancelled.status === 'cancelled', `Full refund should cancel commission, got ${cancelled.status}`);
  assert(cancelled.final_amount_cents === 0, `Full refund should zero commission, got ${cancelled.final_amount_cents}`);

  const leaderSummary = await json(await app.inject({ method: 'GET', url: `/api/leaders/me/commissions?leader_user_id=${leader.id}` }));
  assert(Array.isArray(leaderSummary.commissions) && leaderSummary.commissions.length >= 2, 'Leader commission list should include commissions');
  const adminList = await json(await app.inject({ method: 'GET', url: '/api/admin/commissions' }));
  assert(Array.isArray(adminList) && adminList.length >= 2, 'Admin commission list should be available');

  console.log('L1/L2/L3/L4/L5/L6/L7 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
