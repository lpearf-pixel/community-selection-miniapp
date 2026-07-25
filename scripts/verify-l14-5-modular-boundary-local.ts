import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l14-5-local-verify-encryption-key';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l14-5-${Date.now()}`;

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


function assertStaticBoundaries() {
  const publicIndex = readFileSync('apps/api/src/routes/public/index.ts', 'utf8');
  assert(publicIndex.includes('registerPublicGroupBuyRoutes'), 'public routes should register public group-buy routes');
  assert(!publicIndex.includes('registerGroupBuyRoutes'), 'public routes must not register combined group-buy routes');
  assert(!publicIndex.includes('registerAdminGroupBuyRoutes'), 'public routes must not register admin group-buy routes');

  const adminIndex = readFileSync('apps/api/src/routes/admin/index.ts', 'utf8');
  assert(adminIndex.includes('registerAdminGroupBuyRoutes'), 'admin routes should register admin group-buy routes');

  const orderService = readFileSync('apps/api/src/modules/order/order-service.ts', 'utf8');
  assert(orderService.includes('export async function createGroupOrder'), 'order service should export createGroupOrder');
  assert(orderService.includes('export async function updateOrderStatus'), 'order service should export updateOrderStatus');
  assert(!orderService.includes('TODO boundary'), 'order service should not be TODO-only');

  const purchaseService = readFileSync('apps/api/src/modules/purchase/purchase-service.ts', 'utf8');
  assert(purchaseService.includes('export async function createPurchasePlan'), 'purchase service should export createPurchasePlan');
  assert(purchaseService.includes('export async function receivePurchasePlan'), 'purchase service should export receivePurchasePlan');

  const supplierService = readFileSync('apps/api/src/modules/supplier/supplier-service.ts', 'utf8');
  assert(supplierService.includes('export async function createSupplier'), 'supplier service should export createSupplier');
  assert(supplierService.includes('export async function disableSupplier'), 'supplier service should export disableSupplier');

  const inventoryRoutes = readFileSync('apps/api/src/routes/inventory.ts', 'utf8');
  assert(inventoryRoutes.includes('adjustStockByAdmin'), 'inventory adjust route should call inventory service');
  assert(inventoryRoutes.includes('recordBatchLoss'), 'batch loss route should call inventory service');
  assert(inventoryRoutes.includes('confirmStockCheck'), 'stock check confirm route should call inventory service');
  assert(!inventoryRoutes.includes("source_type: 'manual_adjust'"), 'manual_adjust ledger logic should live outside inventory route');
}

async function adminPost(url: string, payload: unknown, cookie: string) {
  return json(await app.inject({ method: 'POST', url, payload, headers: { cookie } }));
}

async function main() {
  assertStaticBoundaries();
  const adminPassword = `${prefix}-AdminPass123!`;
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'admin', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');

  const category = await prisma.category.create({ data: { name: `${prefix}-cat`, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L14.5 模块边界社区', status: 'active' } });
  const store = await prisma.pickupStore.create({ data: { name: `${prefix}-store`, address: 'L14.5 自提点', phone: '13800000000' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L14.5开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer`, nickname: 'L14.5用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
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
      commission_type: 'fixed',
      commission_value: 100,
      status: 'active'
    }
  });

  const groupBuy = await post('/api/group-buys', { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, end_time: new Date(Date.now() + 3600_000).toISOString(), pickup_time: new Date(Date.now() + 7200_000).toISOString() });
  const order = await post('/api/orders', { user_id: customer.id, group_buy_id: groupBuy.id, client_request_id: `${prefix}-order`, quantity: 2, pickup_store_id: store.id, receiver_name: '模块用户', receiver_phone: '13812345678' });
  assert(order.quantity === 2, 'order should keep sale quantity');
  const unpaidProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(unpaidProduct.stock === 50000, 'unpaid order should not deduct inventory');

  await post('/api/payments/mock', { order_id: order.id });
  const afterPaymentProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterPaymentProduct.stock === 45000, 'paid order should deduct base stock quantity');
  const paymentLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'order_payment', source_id: order.id, event_type: 'order_paid_deduct' } });
  assert(paymentLedger?.quantity === 5000 && paymentLedger.quantity_delta === -5000, 'payment deduction ledger should record 5000 base units');

  let currentOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  for (const nextStatus of ['preparing', 'ready']) {
    const updated = await adminPost(`/api/admin/orders/${order.id}/status`, { next_status: nextStatus, expected_version: currentOrder.version, idempotency_key: `${prefix}-${nextStatus}` }, adminCookie);
    assert(updated.order_status === nextStatus, `order should move to ${nextStatus}`);
    currentOrder = updated;
  }
  const picked = await adminPost(`/api/admin/orders/${order.id}/pickup-verify`, { admin_remark: 'L14.5 模块边界核销' }, adminCookie);
  assert(picked.order_status === 'picked', 'pickup verify should mark order picked');
  assert(await prisma.orderTimelineLog.count({ where: { order_id: order.id, event_type: 'pickup_verified' } }) > 0, 'pickup should write timeline');
  assert(await prisma.businessEventLog.count({ where: { order_id: order.id, event_type: 'pickup_verified' } }) > 0, 'pickup should write business event');
  assert(await prisma.adminAuditLog.count({ where: { action: 'order_pickup_verified', target_id: order.id, admin_user_id: adminUser.id } }) > 0, 'pickup should write admin audit');

  const completed = await adminPost(`/api/admin/orders/${order.id}/status`, { next_status: 'completed', expected_version: picked.version, idempotency_key: `${prefix}-completed` }, adminCookie);
  assert(completed.completed_at, 'completed order should have completed_at');
  const commission = await prisma.commission.findFirst({ where: { order_id: order.id, leader_user_id: leader.id } });
  assert(!commission || ['pending', 'estimated', 'available'].includes(commission.status), `commission status should follow existing rules, got ${commission?.status}`);

  const supplier = await adminPost('/api/admin/suppliers', { name: `${prefix}-供应商`, contact_name: '李四' }, adminCookie);
  await adminPost(`/api/admin/suppliers/${supplier.id}/disable`, {}, adminCookie);
  assert(await prisma.adminAuditLog.count({ where: { action: 'supplier_created', target_id: supplier.id, admin_user_id: adminUser.id } }) > 0, 'supplier create audit should exist');
  assert(await prisma.adminAuditLog.count({ where: { action: 'supplier_disabled', target_id: supplier.id, admin_user_id: adminUser.id } }) > 0, 'supplier disable audit should exist');

  const purchasePlan = await adminPost('/api/admin/purchase-plans', {
    target_date: new Date(Date.now() + 86_400_000).toISOString(),
    supplier_name: supplier.name,
    items: [{ product_id: product.id, purchase_quantity: 3, purchase_unit: '箱', stock_in_quantity: 30000, cost_price_cents: 8000, remark: 'L14.5采购' }],
    remark: 'L14.5模块边界采购计划'
  }, adminCookie);
  await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/confirm`, {}, adminCookie);
  await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/receive`, { remark: 'L14.5入库', items: [{ item_id: purchasePlan.items[0].id, received_quantity: 30000, supplier_id: supplier.id, arrival_date: new Date().toISOString(), shelf_life_days: 3 }] }, adminCookie);
  const afterReceiveProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterReceiveProduct.stock === 75000, 'purchase receive should add 30000 base units');
  const purchaseStockLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'purchase_in', source_id: purchasePlan.id } });
  assert(purchaseStockLedger?.quantity === 30000, 'purchase_in ledger should exist');
  assert(await prisma.adminAuditLog.count({ where: { action: 'purchase_plan_received', target_id: purchasePlan.id, admin_user_id: adminUser.id } }) > 0, 'purchase receive audit should exist');
  const batch = await prisma.productBatch.findFirst({ where: { product_id: product.id, purchase_plan_id: purchasePlan.id } });
  assert(batch?.remaining_quantity === 30000, 'product batch should be created on receive');
  assert(await prisma.batchStockLedger.count({ where: { batch_id: batch.id, source_type: 'purchase_batch_in' } }) > 0, 'purchase batch ledger should exist');

  const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(compliance.status === 0, 'compliance scan should pass');

  console.log('L14.5 modular boundary verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
