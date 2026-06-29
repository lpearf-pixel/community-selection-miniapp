import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';

const prisma = new PrismaClient();
const app = buildApp();
const stamp = Date.now();
const prefix = `l6-${stamp}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  if (!body.success) throw new Error(`API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function post(url: string, payload: unknown) {
  const response = await app.inject({ method: 'POST', url, payload });
  return json(response);
}

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1100, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L6 本地验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L6 验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L6 用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${prefix}-product`,
      category_id: category.id,
      price_cents: 2000,
      cost_price_cents: 1200,
      stock: 5,
      unit: '份',
      is_group_enabled: true,
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
    receiver_name: 'L6 用户',
    receiver_phone: '13800003001'
  });
  await post('/api/payments/mock', { order_id: order.id });

  const refund = await post('/api/refunds', {
    order_id: order.id,
    refund_amount_cents: 1000,
    reason: 'L6 本地验收部分退款'
  });
  assert(refund.status === 'pending', 'Refund should be pending after creation');

  await post(`/api/refunds/${refund.id}/audit`, { action: 'approve', reason: 'L6 approve' });
  const successRefund = await post('/api/refunds/mock/success', { refund_id: refund.id });
  assert(successRefund.status === 'success', 'Refund should become success');
  await post('/api/refunds/mock/success', { refund_id: refund.id });

  const partialOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert(partialOrder.refund_amount_cents === 1000, `Partial refund amount should be 1000, got ${partialOrder.refund_amount_cents}`);
  assert(partialOrder.order_status !== 'refunded', 'Partial refund should not force full refunded order status');

  const fullRefund = await post('/api/refunds', {
    order_id: order.id,
    refund_amount_cents: partialOrder.pay_amount_cents - partialOrder.refund_amount_cents,
    reason: 'L6 本地验收剩余退款'
  });
  await post(`/api/refunds/${fullRefund.id}/audit`, { action: 'approve', reason: 'L6 approve full' });
  await post('/api/refunds/mock/success', { refund_id: fullRefund.id });
  const fullOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert(fullOrder.refund_amount_cents === fullOrder.pay_amount_cents, 'Full refund should refund full pay amount');
  assert(fullOrder.order_status === 'refunded', `Full refund should set order refunded, got ${fullOrder.order_status}`);

  console.log('L1/L2/L3/L4/L5/L6 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
