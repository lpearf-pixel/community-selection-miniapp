import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { expireOverdueGroupBuys } from '../apps/api/src/routes/group-buys.js';

const prisma = new PrismaClient();
const app = buildApp();
const stamp = Date.now();
const prefix = `l4-${stamp}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  if (!body.success) {
    throw new Error(`API failed ${response.statusCode}: ${body.message}`);
  }
  return body.data;
}

async function post(url: string, payload: unknown) {
  const response = await app.inject({ method: 'POST', url, payload });
  return json(response);
}

async function expectFail(url: string, payload: unknown, expectedMessage: string) {
  const response = await app.inject({ method: 'POST', url, payload });
  const body = response.json() as { success: boolean; message: string };
  assert(response.statusCode === 400, `Expected ${url} to fail with 400`);
  assert(body.success === false, `Expected ${url} success=false`);
  assert(body.message.includes(expectedMessage), `Expected message containing ${expectedMessage}, got ${body.message}`);
}

async function main() {
  const category = await prisma.category.create({
    data: { name: `${prefix}-category`, sort_order: 999, status: 'active' }
  });
  const community = await prisma.community.create({
    data: { name: `${prefix}-community`, address: 'L4 本地验收社区', status: 'active' }
  });
  const leader = await prisma.user.create({
    data: { openid: `${prefix}-leader`, nickname: 'L4 验收开团人', role: 'leader', status: 'active' }
  });
  const userA = await prisma.user.create({
    data: { openid: `${prefix}-user-a`, nickname: 'L4 用户 A', role: 'customer', status: 'active' }
  });
  const userB = await prisma.user.create({
    data: { openid: `${prefix}-user-b`, nickname: 'L4 用户 B', role: 'customer', status: 'active' }
  });

  const product = await prisma.product.create({
    data: {
      name: `${prefix}-product-success`,
      category_id: category.id,
      description: 'L4 local verification product',
      price_cents: 1000,
      cost_price_cents: 600,
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
    min_people: 2,
    min_quantity: 3,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  assert(groupBuy.status === 'pending', 'Created group buy should be pending');

  const orderA = await post('/api/orders', {
    user_id: userA.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order-a`,
    quantity: 2,
    receiver_name: '用户 A',
    receiver_phone: '13800001001'
  });
  assert(orderA.quantity === 2, 'Order A quantity should be saved');
  const stockAfterA = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(stockAfterA.stock === 3, `Stock after order A should be 3, got ${stockAfterA.stock}`);

  const orderADuplicate = await post('/api/orders', {
    user_id: userA.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order-a`,
    quantity: 2,
    receiver_name: '用户 A',
    receiver_phone: '13800001001'
  });
  assert(orderADuplicate.id === orderA.id, 'Duplicate client_request_id should return existing order');
  const stockAfterDuplicate = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(stockAfterDuplicate.stock === 3, 'Duplicate order must not decrement stock again');

  await post('/api/payments/mock', { order_id: orderA.id });
  await post('/api/payments/mock', { order_id: orderA.id });
  let paidGroup = await prisma.groupBuy.findUniqueOrThrow({ where: { id: groupBuy.id } });
  assert(paidGroup.current_people === 1, `Mock pay must count people once, got ${paidGroup.current_people}`);
  assert(paidGroup.current_quantity === 2, `Mock pay must count quantity 2, got ${paidGroup.current_quantity}`);

  const orderB = await post('/api/orders', {
    user_id: userB.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order-b`,
    quantity: 1,
    receiver_name: '用户 B',
    receiver_phone: '13800001002'
  });
  await post('/api/payments/mock', { order_id: orderB.id });
  paidGroup = await prisma.groupBuy.findUniqueOrThrow({ where: { id: groupBuy.id } });
  assert(paidGroup.status === 'success', `Group should become success, got ${paidGroup.status}`);
  assert(paidGroup.current_people === 2, `Group people should be 2, got ${paidGroup.current_people}`);
  assert(paidGroup.current_quantity === 3, `Group quantity should be 3, got ${paidGroup.current_quantity}`);
  const groupedOrders = await prisma.order.findMany({ where: { group_buy_id: groupBuy.id, pay_status: 'paid' } });
  assert(groupedOrders.every((order) => order.order_status === 'grouped'), 'Paid orders should be grouped after success');

  await expectFail('/api/orders', {
    user_id: userB.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order-too-many`,
    quantity: 99,
    receiver_name: '用户 B',
    receiver_phone: '13800001002'
  }, '库存不足');

  const csvResponse = await app.inject({ method: 'GET', url: '/api/orders/export/picking.csv' });
  assert(csvResponse.statusCode === 200, `Picking CSV status should be 200, got ${csvResponse.statusCode}`);
  assert(csvResponse.body.includes(orderA.order_no), 'Picking CSV should include grouped order A');

  const failProduct = await prisma.product.create({
    data: {
      name: `${prefix}-product-fail`,
      category_id: category.id,
      description: 'L4 local verification failed group product',
      price_cents: 1200,
      cost_price_cents: 700,
      stock: 10,
      unit: '份',
      is_group_enabled: true,
      status: 'active'
    }
  });
  const failGroup = await post('/api/group-buys', {
    product_id: failProduct.id,
    leader_user_id: leader.id,
    community_id: community.id,
    min_people: 10,
    min_quantity: 10,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  const paidFailOrder = await post('/api/orders', {
    user_id: userA.id,
    group_buy_id: failGroup.id,
    client_request_id: `${prefix}-paid-fail-order`,
    quantity: 2,
    receiver_name: '用户 A',
    receiver_phone: '13800001001'
  });
  await post('/api/payments/mock', { order_id: paidFailOrder.id });
  const unpaidFailOrder = await post('/api/orders', {
    user_id: userB.id,
    group_buy_id: failGroup.id,
    client_request_id: `${prefix}-unpaid-fail-order`,
    quantity: 3,
    receiver_name: '用户 B',
    receiver_phone: '13800001002'
  });
  await prisma.groupBuy.update({ where: { id: failGroup.id }, data: { end_time: new Date(Date.now() - 60_000) } });
  await expireOverdueGroupBuys();
  await expireOverdueGroupBuys();

  const expiredGroup = await prisma.groupBuy.findUniqueOrThrow({ where: { id: failGroup.id } });
  assert(expiredGroup.status === 'failed', `Expired group should be failed, got ${expiredGroup.status}`);
  const refundedPaidOrder = await prisma.order.findUniqueOrThrow({ where: { id: paidFailOrder.id } });
  assert(refundedPaidOrder.order_status === 'refunding', `Paid failed order should be refunding, got ${refundedPaidOrder.order_status}`);
  assert(refundedPaidOrder.refund_status === 'pending', `Paid failed order refund should be pending, got ${refundedPaidOrder.refund_status}`);
  const closedUnpaidOrder = await prisma.order.findUniqueOrThrow({ where: { id: unpaidFailOrder.id } });
  assert(closedUnpaidOrder.order_status === 'closed', `Unpaid failed order should be closed, got ${closedUnpaidOrder.order_status}`);
  assert(closedUnpaidOrder.pay_status === 'closed', `Unpaid failed order pay_status should be closed, got ${closedUnpaidOrder.pay_status}`);
  const refund = await prisma.refund.findUnique({ where: { out_refund_no: `RF${paidFailOrder.order_no}` } });
  assert(refund?.status === 'pending', 'Pending refund record should be created idempotently');
  const restoredFailProduct = await prisma.product.findUniqueOrThrow({ where: { id: failProduct.id } });
  assert(restoredFailProduct.stock === 10, `Failed group should restore stock to 10, got ${restoredFailProduct.stock}`);

  console.log('L1/L2/L3/L4 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
