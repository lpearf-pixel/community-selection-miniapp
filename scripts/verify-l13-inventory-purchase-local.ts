import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';
import {
  enableConsumerVerifierMockIdentity,
  injectAsConsumer,
} from './lib/consumer-verifier-request.js';

enableConsumerVerifierMockIdentity();
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l13-local-verify-encryption-key';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l13-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function payloadOf(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function post(url: string, payload: unknown) {
  return json(await app.inject({ method: 'POST', url, payload }));
}

async function consumerPost(url: string, userId: string, payload: unknown) {
  return json(
    await injectAsConsumer(app, userId, { method: 'POST', url, payload }),
  );
}

async function adminPost(url: string, payload: unknown, cookie: string) {
  return json(await app.inject({ method: 'POST', url, payload, headers: { cookie } }));
}

async function adminGet(url: string, cookie: string) {
  return app.inject({ method: 'GET', url, headers: { cookie } });
}

async function main() {
  const adminPassword = `${prefix}-AdminPass123!`;
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'operator', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');

  const category = await prisma.category.create({ data: { name: `${prefix}-cat` } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'community address' } });
  const store = await prisma.pickupStore.create({ data: { name: `${prefix}-store`, address: 'store address', phone: '13800000000' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L13开团人', role: 'leader' } });
  const appleUser = await prisma.user.create({ data: { openid: `${prefix}-apple-user`, nickname: 'L13苹果用户', role: 'customer' } });
  const eggUser = await prisma.user.create({ data: { openid: `${prefix}-egg-user`, nickname: 'L13鸡蛋用户', role: 'customer' } });

  const apple = await prisma.product.create({
    data: {
      name: `${prefix}-苹果5斤装`,
      category_id: category.id,
      price_cents: 3980,
      cost_price_cents: 2500,
      stock: 50000,
      unit: '份',
      stock_unit: 'g',
      sale_unit: '份',
      sale_spec_name: '5斤装',
      stock_deduct_quantity: 2500,
      is_group_enabled: true,
      status: 'active',
      commission_type: 'fixed',
      commission_value: 100
    }
  });
  const appleGroupBuy = await post('/api/group-buys', { product_id: apple.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, end_time: new Date(Date.now() + 3600_000).toISOString(), pickup_time: new Date(Date.now() + 7200_000).toISOString() });
  const appleOrder = await consumerPost('/api/orders', appleUser.id, { group_buy_id: appleGroupBuy.id, client_request_id: `${prefix}-apple-order`, quantity: 2, pickup_store_id: store.id, receiver_name: '苹果用户', receiver_phone: '13812345678' });
  assert(appleOrder.quantity === 2, 'apple order should keep sale quantity');
  const applePayment = await post('/api/payments/mock', { order_id: appleOrder.id });
  assert(applePayment.pay_status === 'paid', 'apple order payment should succeed before inventory is deducted');

  const afterAppleOrder = await prisma.product.findUniqueOrThrow({ where: { id: apple.id } });
  assert(afterAppleOrder.stock === 45000, 'apple stock should decrease by sale quantity multiplied by stock_deduct_quantity');
  const appleOrderLedger = await prisma.stockLedger.findFirst({ where: { product_id: apple.id, source_type: 'order_payment', source_id: appleOrder.id, event_type: 'order_paid_deduct' } });
  assert(appleOrderLedger?.direction === 'out', 'apple payment deduction ledger should be out');
  assert(appleOrderLedger.quantity === 5000 && appleOrderLedger.quantity_delta === -5000 && appleOrderLedger.stock_before === 50000 && appleOrderLedger.stock_after === 45000, 'apple payment deduction ledger stock should be correct');
  const appleOrderPayload = payloadOf(appleOrderLedger.payload);
  assert(appleOrderPayload.order_id === appleOrder.id && appleOrderPayload.order_quantity === 2 && appleOrderPayload.stock_deduct_quantity === 2500, 'apple payment deduction payload should keep order and stock conversion context');

  const egg = await prisma.product.create({
    data: {
      name: `${prefix}-鸡蛋30枚盒`,
      category_id: category.id,
      price_cents: 2990,
      cost_price_cents: 1800,
      stock: 900,
      unit: '盒',
      stock_unit: 'egg',
      sale_unit: '盒',
      sale_spec_name: '30枚/盒',
      stock_deduct_quantity: 30,
      is_group_enabled: true,
      status: 'active',
      commission_type: 'fixed',
      commission_value: 100
    }
  });
  const eggGroupBuy = await post('/api/group-buys', { product_id: egg.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, end_time: new Date(Date.now() + 3600_000).toISOString(), pickup_time: new Date(Date.now() + 7200_000).toISOString() });
  const eggOrder = await consumerPost('/api/orders', eggUser.id, { group_buy_id: eggGroupBuy.id, client_request_id: `${prefix}-egg-order`, quantity: 3, pickup_store_id: store.id, receiver_name: '鸡蛋用户', receiver_phone: '13912345678' });
  const eggPayment = await post('/api/payments/mock', { order_id: eggOrder.id });
  assert(eggPayment.pay_status === 'paid', 'egg order payment should succeed before inventory is deducted');
  const afterEggOrder = await prisma.product.findUniqueOrThrow({ where: { id: egg.id } });
  assert(afterEggOrder.stock === 810, 'egg stock should decrease by 90 eggs');
  const eggOrderLedger = await prisma.stockLedger.findFirst({ where: { product_id: egg.id, source_type: 'order_payment', source_id: eggOrder.id, event_type: 'order_paid_deduct' } });
  assert(eggOrderLedger?.quantity === 90 && eggOrderLedger.quantity_delta === -90, 'egg payment deduction ledger should record 90 base units');

  const inventoryOverview = await json(await adminGet('/api/admin/inventory/overview', adminCookie));
  assert(inventoryOverview.items.some((item: any) => item.product_id === apple.id && item.stock === 45000 && item.stock_unit === 'g' && item.display_sale_spec === '5斤装 / 份'), 'inventory overview should include unit-aware apple stock');

  const unauthorizedAdjust = await app.inject({ method: 'POST', url: `/api/admin/inventory/products/${apple.id}/adjust`, payload: { adjust_quantity: 5000, reason: '未登录调整' } });
  assert(unauthorizedAdjust.statusCode === 401, 'inventory adjust should require admin session');
  await adminPost(
    `/api/admin/inventory/products/${apple.id}/adjust`,
    {
      expected_stock: 45000,
      adjust_quantity: 5000,
      reason: '验收增加苹果库存',
      idempotency_key: `${prefix}-inventory-adjust`,
    },
    adminCookie,
  );
  const afterAdjustApple = await prisma.product.findUniqueOrThrow({ where: { id: apple.id } });
  assert(afterAdjustApple.stock === 50000, 'manual adjustment should increase apple stock by base units');
  const manualLedger = await prisma.stockLedger.findFirst({ where: { product_id: apple.id, source_type: 'manual_adjust' }, orderBy: { created_at: 'desc' } });
  assert(manualLedger?.direction === 'in' && manualLedger.quantity === 5000 && manualLedger.operator_id === adminUser.id, 'manual adjust ledger should be written by admin');
  assert(payloadOf(manualLedger.payload).stock_unit === 'g', 'manual adjust ledger payload should keep stock unit');
  const adjustAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'inventory_manual_adjusted', target_id: apple.id } });
  assert(adjustAuditLog?.admin_user_id === adminUser.id, 'manual adjust audit should record admin');

  const unauthorizedCreatePlan = await app.inject({ method: 'POST', url: '/api/admin/purchase-plans', payload: { target_date: new Date().toISOString(), items: [] } });
  assert(unauthorizedCreatePlan.statusCode === 401, 'purchase plan create should require admin session');
  const purchasePlan = await adminPost('/api/admin/purchase-plans', {
    target_date: new Date(Date.now() + 86_400_000).toISOString(),
    supplier_name: '验收供应商',
    remark: 'L13验收采购计划',
    items: [{ product_id: apple.id, purchase_quantity: 3, purchase_unit: '箱', stock_in_quantity: 30000, cost_price_cents: 8000, remark: '采购3箱折算30000g' }]
  }, adminCookie);
  assert(purchasePlan.status === 'draft' && purchasePlan.total_quantity === 30000 && purchasePlan.total_amount_cents === 24000, 'purchase plan should aggregate stock-in quantity and purchase amount');
  assert(purchasePlan.items[0].planned_quantity === 30000 && purchasePlan.items[0].purchase_quantity === 3 && purchasePlan.items[0].purchase_unit === '箱', 'purchase plan item should keep purchase unit and stock-in quantity');
  const createdAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'purchase_plan_created', target_id: purchasePlan.id } });
  assert(createdAuditLog?.admin_user_id === adminUser.id, 'purchase plan create audit should record admin');

  const confirmedPlan = await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/confirm`, {}, adminCookie);
  assert(confirmedPlan.status === 'confirmed', 'purchase plan should confirm');
  const confirmedAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'purchase_plan_confirmed', target_id: purchasePlan.id } });
  assert(confirmedAuditLog?.admin_user_id === adminUser.id, 'purchase plan confirm audit should record admin');

  const unauthorizedReceive = await app.inject({ method: 'POST', url: `/api/admin/purchase-plans/${purchasePlan.id}/receive`, payload: { items: [{ item_id: purchasePlan.items[0].id, received_quantity: 30000 }] } });
  assert(unauthorizedReceive.statusCode === 401, 'purchase plan receive should require admin session');
  const receivedPlan = await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/receive`, { idempotency_key: `${prefix}-purchase-receive`, remark: '验收入库', items: [{ item_id: purchasePlan.items[0].id, received_quantity: 30000 }] }, adminCookie);
  assert(receivedPlan.status === 'received' || receivedPlan.status === 'ordered', 'purchase plan should become received or ordered');
  const afterReceiveApple = await prisma.product.findUniqueOrThrow({ where: { id: apple.id } });
  assert(afterReceiveApple.stock === 80000, 'purchase receive should increase apple stock by base units');
  const purchaseLedger = await prisma.stockLedger.findFirst({ where: { product_id: apple.id, source_type: 'purchase_in', source_id: purchasePlan.id } });
  assert(purchaseLedger?.direction === 'in' && purchaseLedger.quantity === 30000 && purchaseLedger.operator_id === adminUser.id, 'purchase in ledger should be written with base stock units');
  const purchasePayload = payloadOf(purchaseLedger.payload);
  assert(purchasePayload.purchase_unit === '箱' && purchasePayload.stock_unit === 'g', 'purchase in ledger payload should keep purchase unit and stock unit');
  const receivedAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'purchase_plan_received', target_id: purchasePlan.id } });
  assert(receivedAuditLog?.admin_user_id === adminUser.id, 'purchase receive audit should record admin');

  const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(compliance.status === 0, 'compliance scan should pass');

  console.log('L13 inventory and purchase verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
