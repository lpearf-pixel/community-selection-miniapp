import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l13-local-verify-encryption-key';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l13-${Date.now()}`;

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
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L13开团人', role: 'leader' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L13用户', role: 'customer' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 1000, cost_price_cents: 600, stock: 100, unit: '份', is_group_enabled: true, status: 'active', commission_type: 'fixed', commission_value: 100 } });
  const groupBuy = await post('/api/group-buys', { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, end_time: new Date(Date.now() + 3600_000).toISOString(), pickup_time: new Date(Date.now() + 7200_000).toISOString() });
  const order = await post('/api/orders', { user_id: user.id, group_buy_id: groupBuy.id, client_request_id: `${prefix}-order`, quantity: 3, receiver_name: '库存用户', receiver_phone: '13812345678' });

  const afterOrderProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterOrderProduct.stock === 97, 'product stock should decrease after order create');
  const orderLockLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'order_lock', source_id: order.id } });
  assert(orderLockLedger?.direction === 'out', 'order lock ledger should be out');
  assert(orderLockLedger.quantity === 3 && orderLockLedger.stock_before === 100 && orderLockLedger.stock_after === 97, 'order lock ledger stock should be correct');

  const inventoryOverview = await json(await adminGet('/api/admin/inventory/overview', adminCookie));
  assert(inventoryOverview.items.some((item: any) => item.product_id === product.id && item.stock === 97), 'inventory overview should include product stock');

  const unauthorizedAdjust = await app.inject({ method: 'POST', url: `/api/admin/inventory/products/${product.id}/adjust`, payload: { adjust_quantity: 5, reason: '未登录调整' } });
  assert(unauthorizedAdjust.statusCode === 401, 'inventory adjust should require admin session');
  await adminPost(`/api/admin/inventory/products/${product.id}/adjust`, { adjust_quantity: 5, reason: '验收增加库存' }, adminCookie);
  const afterAdjustProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterAdjustProduct.stock === 102, 'manual adjustment should increase stock');
  const manualLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'manual_adjust' }, orderBy: { created_at: 'desc' } });
  assert(manualLedger?.direction === 'in' && manualLedger.operator_id === adminUser.id, 'manual adjust ledger should be written by admin');
  const adjustAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'inventory_manual_adjusted', target_id: product.id } });
  assert(adjustAuditLog?.admin_user_id === adminUser.id, 'manual adjust audit should record admin');

  const unauthorizedCreatePlan = await app.inject({ method: 'POST', url: '/api/admin/purchase-plans', payload: { target_date: new Date().toISOString(), items: [] } });
  assert(unauthorizedCreatePlan.statusCode === 401, 'purchase plan create should require admin session');
  const purchasePlan = await adminPost('/api/admin/purchase-plans', {
    target_date: new Date(Date.now() + 86_400_000).toISOString(),
    supplier_name: '验收供应商',
    remark: 'L13验收采购计划',
    items: [{ product_id: product.id, planned_quantity: 7, cost_price_cents: 500, remark: '验收明细' }]
  }, adminCookie);
  assert(purchasePlan.status === 'draft' && purchasePlan.total_quantity === 7 && purchasePlan.total_amount_cents === 3500, 'purchase plan should aggregate totals');
  const createdAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'purchase_plan_created', target_id: purchasePlan.id } });
  assert(createdAuditLog?.admin_user_id === adminUser.id, 'purchase plan create audit should record admin');

  const confirmedPlan = await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/confirm`, {}, adminCookie);
  assert(confirmedPlan.status === 'confirmed', 'purchase plan should confirm');
  const confirmedAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'purchase_plan_confirmed', target_id: purchasePlan.id } });
  assert(confirmedAuditLog?.admin_user_id === adminUser.id, 'purchase plan confirm audit should record admin');

  const unauthorizedReceive = await app.inject({ method: 'POST', url: `/api/admin/purchase-plans/${purchasePlan.id}/receive`, payload: { items: [{ item_id: purchasePlan.items[0].id, received_quantity: 1 }] } });
  assert(unauthorizedReceive.statusCode === 401, 'purchase plan receive should require admin session');
  const receivedPlan = await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/receive`, { remark: '验收入库', items: [{ item_id: purchasePlan.items[0].id, received_quantity: 7 }] }, adminCookie);
  assert(receivedPlan.status === 'received' || receivedPlan.status === 'ordered', 'purchase plan should become received or ordered');
  const afterReceiveProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterReceiveProduct.stock === 109, 'purchase receive should increase product stock');
  const purchaseLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'purchase_in', source_id: purchasePlan.id } });
  assert(purchaseLedger?.direction === 'in' && purchaseLedger.quantity === 7 && purchaseLedger.operator_id === adminUser.id, 'purchase in ledger should be written');
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
