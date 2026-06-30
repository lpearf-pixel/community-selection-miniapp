import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';

const prisma = new PrismaClient();
const app = buildApp();
const stamp = Date.now();
const prefix = `l5-${stamp}`;

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

function scanComplianceText() {
  const files = [
    'prisma/schema.prisma',
    'apps/api/src/routes/group-buys.ts',
    'apps/api/src/routes/payments.ts',
    'apps/api/src/services/payment-service.ts',
    'apps/miniapp/pages/join-order/index.js',
    'apps/miniapp/pages/start-group-buy/index.js',
    'apps/miniapp/pages/join-order/index.wxml',
    'apps/miniapp/pages/start-group-buy/index.wxml'
  ];
  const forbidden = [
    ['parent', 'leader', 'id'].join('_'),
    ['upline', 'id'].join('_'),
    ['team', 'id'].join('_'),
    ['down', 'line'].join(''),
    '返' + '利',
    '分' + '销',
    '下级' + '收益',
    '团队' + '收益',
    '代理' + '收益',
    '二级' + '返佣',
    '三级' + '返佣',
    '躺' + '赚'
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const word of forbidden) {
      assert(!source.includes(word), `${file} contains forbidden text: ${word}`);
    }
  }
}

async function main() {
  scanComplianceText();

  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1000, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L5 本地验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L5 验收开团人', role: 'leader', status: 'active' } });
  const userA = await prisma.user.create({ data: { openid: `${prefix}-user-a`, nickname: 'L5 用户 A', role: 'customer', status: 'active' } });
  const userB = await prisma.user.create({ data: { openid: `${prefix}-user-b`, nickname: 'L5 用户 B', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${prefix}-product`,
      category_id: category.id,
      description: 'L5 local verification product',
      price_cents: 1500,
      cost_price_cents: 900,
      stock: 8,
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

  const orderA = await post('/api/orders', {
    user_id: userA.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order-a`,
    quantity: 2,
    receiver_name: '用户 A',
    receiver_phone: '13800002001'
  });
  assert(orderA.pay_status === 'unpaid', 'New order should be unpaid');

  const mockPayA = await post('/api/payments/mock', { order_id: orderA.id });
  assert(mockPayA.payment.amount_cents === orderA.pay_amount_cents, 'Payment amount should match order pay amount');
  assert(mockPayA.order.pay_status === 'paid', 'Order should become paid after mock payment');

  let paymentCount = await prisma.payment.count({ where: { order_id: orderA.id } });
  let paidGroup = await prisma.groupBuy.findUniqueOrThrow({ where: { id: groupBuy.id } });
  assert(paymentCount === 1, `Payment count should be 1, got ${paymentCount}`);
  assert(paidGroup.current_people === 1, `current_people should be 1, got ${paidGroup.current_people}`);
  assert(paidGroup.current_quantity === 2, `current_quantity should be 2, got ${paidGroup.current_quantity}`);

  await post('/api/payments/mock', { order_id: orderA.id });
  paymentCount = await prisma.payment.count({ where: { order_id: orderA.id } });
  paidGroup = await prisma.groupBuy.findUniqueOrThrow({ where: { id: groupBuy.id } });
  assert(paymentCount === 1, 'Repeated mock payment must not create another Payment');
  assert(paidGroup.current_people === 1, 'Repeated mock payment must not increment current_people');
  assert(paidGroup.current_quantity === 2, 'Repeated mock payment must not increment current_quantity');

  const orderB = await post('/api/orders', {
    user_id: userB.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order-b`,
    quantity: 1,
    receiver_name: '用户 B',
    receiver_phone: '13800002002'
  });
  await post('/api/payments/mock', { order_id: orderB.id });
  paidGroup = await prisma.groupBuy.findUniqueOrThrow({ where: { id: groupBuy.id } });
  assert(paidGroup.status === 'success', `Group should be success, got ${paidGroup.status}`);

  await expectFail('/api/payments/mock', { order_id: 'missing-order-id' }, '订单不存在');

  const csvResponse = await app.inject({ method: 'GET', url: '/api/orders/export/picking.csv' });
  assert(csvResponse.statusCode === 200, `Picking CSV status should be 200, got ${csvResponse.statusCode}`);
  assert(csvResponse.body.includes(orderA.order_no), 'Picking CSV should include paid order A');

  console.log('L1/L2/L3/L4/L5 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
