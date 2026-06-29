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

async function expectFail(url: string, payload: unknown, expectedMessage: string) {
  const response = await app.inject({ method: 'POST', url, payload });
  const body = response.json() as { success: boolean; message: string };
  assert(body.success === false, `Expected ${url} to fail`);
  assert(body.message.includes(expectedMessage), `Expected ${expectedMessage}, got ${body.message}`);
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

  const refund = await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 1000,
    reason: 'L6 本地验收部分退款',
    client_refund_id: `${prefix}-partial-refund`
  });
  assert(refund.status === 'success', 'Mock refund should immediately become success');

  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 1000,
    reason: 'L6 本地验收部分退款',
    client_refund_id: `${prefix}-partial-refund`
  });
  let refundCount = await prisma.refund.count({ where: { order_id: order.id } });
  assert(refundCount === 1, `Repeated client_refund_id should keep one refund, got ${refundCount}`);

  const partialOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert(partialOrder.refund_amount_cents === 1000, `Partial refund amount should be 1000, got ${partialOrder.refund_amount_cents}`);
  assert(partialOrder.order_status !== 'refunded', 'Partial refund should not force full refunded order status');

  const productBeforeFullRefund = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: partialOrder.pay_amount_cents - partialOrder.refund_amount_cents,
    reason: 'L6 本地验收剩余退款',
    client_refund_id: `${prefix}-full-refund`
  });
  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: partialOrder.pay_amount_cents - partialOrder.refund_amount_cents,
    reason: 'L6 本地验收剩余退款',
    client_refund_id: `${prefix}-full-refund`
  });
  refundCount = await prisma.refund.count({ where: { order_id: order.id } });
  assert(refundCount === 2, `Full refund repeat should not create another refund, got ${refundCount}`);
  const fullOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert(fullOrder.refund_amount_cents === fullOrder.pay_amount_cents, 'Full refund should refund full pay amount');
  assert(fullOrder.order_status === 'refunded', `Full refund should set order refunded, got ${fullOrder.order_status}`);
  const productAfterFullRefund = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(productAfterFullRefund.stock === productBeforeFullRefund.stock + order.quantity, 'Full refund should restore stock once by order quantity');

  const refundsList = await json(await app.inject({ method: 'GET', url: '/api/refunds' }));
  assert(Array.isArray(refundsList) && refundsList.length >= 2, 'Refund list should be available');
  const refundDetail = await json(await app.inject({ method: 'GET', url: `/api/refunds/${refund.id}` }));
  assert(refundDetail.id === refund.id, 'Refund detail should be available');


  const unpaidOrder = await post('/api/orders', {
    user_id: user.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-unpaid-order`,
    quantity: 1,
    receiver_name: 'L6 用户',
    receiver_phone: '13800003001'
  });
  await expectFail('/api/refunds/mock', {
    order_id: unpaidOrder.id,
    refund_amount_cents: 100,
    reason: '未支付订单退款校验',
    client_refund_id: `${prefix}-unpaid-refund`
  }, '未支付订单不能退款');

  console.log('L1/L2/L3/L4/L5/L6 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
