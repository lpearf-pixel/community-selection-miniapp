import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l14-local-verify-encryption-key';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l14-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function adminPost(url: string, payload: unknown, cookie: string) {
  return json(await app.inject({ method: 'POST', url, payload, headers: { cookie } }));
}

async function adminGet(url: string, cookie: string) {
  return json(await app.inject({ method: 'GET', url, headers: { cookie } }));
}

async function main() {
  const adminPassword = `${prefix}-AdminPass123!`;
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'operator', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');

  const unauthorizedSupplier = await app.inject({ method: 'POST', url: '/api/admin/suppliers', payload: { name: `${prefix}-unauthorized` } });
  assert(unauthorizedSupplier.statusCode === 401, 'supplier create should require admin session');
  const supplier = await adminPost('/api/admin/suppliers', { name: `${prefix}-供应商`, contact_name: '张三', contact_phone: '13800000000', remark: 'L14验收供应商' }, adminCookie);
  assert(supplier.name === `${prefix}-供应商`, 'supplier should be created');

  const category = await prisma.category.create({ data: { name: `${prefix}-cat` } });
  const product = await prisma.product.create({
    data: {
      name: `${prefix}-苹果5斤装`,
      category_id: category.id,
      price_cents: 3980,
      cost_price_cents: 2500,
      stock: 0,
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

  const purchasePlan = await adminPost('/api/admin/purchase-plans', {
    target_date: new Date(Date.now() + 86_400_000).toISOString(),
    supplier_name: supplier.name,
    remark: 'L14批次验收采购计划',
    items: [{ product_id: product.id, purchase_quantity: 3, purchase_unit: '箱', stock_in_quantity: 30000, cost_price_cents: 8000, remark: '采购3箱折算30000g' }]
  }, adminCookie);
  await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/confirm`, {}, adminCookie);
  const arrivalDate = new Date();
  await adminPost(`/api/admin/purchase-plans/${purchasePlan.id}/receive`, {
    remark: 'L14批次入库',
    items: [{ item_id: purchasePlan.items[0].id, received_quantity: 30000, supplier_id: supplier.id, arrival_date: arrivalDate.toISOString(), shelf_life_days: 3, remark: '首批苹果入库' }]
  }, adminCookie);

  const afterReceiveProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterReceiveProduct.stock === 30000, 'receive should increase product stock by 30000g');
  const batch = await prisma.productBatch.findFirst({ where: { product_id: product.id, purchase_plan_id: purchasePlan.id } });
  assert(batch?.initial_quantity === 30000 && batch.remaining_quantity === 30000 && batch.supplier_id === supplier.id, 'product batch should be created with supplier and quantity');
  const batchInLedger = await prisma.batchStockLedger.findFirst({ where: { batch_id: batch.id, source_type: 'purchase_batch_in' } });
  assert(batchInLedger?.quantity === 30000, 'purchase batch in ledger should exist');
  const stockInLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'purchase_in', source_id: purchasePlan.id } });
  assert(stockInLedger?.quantity === 30000, 'stock ledger purchase_in should still exist');
  const batchAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'purchase_batch_created', target_id: batch.id } });
  assert(batchAuditLog?.admin_user_id === adminUser.id, 'purchase batch audit should record admin');

  const batches = await adminGet('/api/admin/inventory/batches', adminCookie);
  assert(batches.some((item: any) => item.id === batch.id), 'batch list should include created batch');
  const expiryAlerts = await adminGet('/api/admin/inventory/expiry-alerts?days=7', adminCookie);
  assert(expiryAlerts.items.some((item: any) => item.batch_id === batch.id), 'expiry alerts should include expiring batch');

  const unauthorizedLoss = await app.inject({ method: 'POST', url: `/api/admin/inventory/batches/${batch.id}/loss`, payload: { quantity: 2000, loss_type: 'bad_fruit', reason: '坏果损耗' } });
  assert(unauthorizedLoss.statusCode === 401, 'batch loss should require admin session');
  const loss = await adminPost(`/api/admin/inventory/batches/${batch.id}/loss`, { quantity: 2000, loss_type: 'bad_fruit', reason: '坏果损耗', responsible_type: 'supplier', supplier_id: supplier.id }, adminCookie);
  const afterLossBatch = await prisma.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
  const afterLossProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterLossBatch.remaining_quantity === 28000, 'loss should decrease batch remaining quantity');
  assert(afterLossProduct.stock === 28000, 'loss should decrease product stock');
  const inventoryLoss = await prisma.inventoryLoss.findUnique({ where: { id: loss.id } });
  assert(inventoryLoss?.quantity === 2000, 'inventory loss should be recorded');
  const lossBatchLedger = await prisma.batchStockLedger.findFirst({ where: { batch_id: batch.id, source_type: 'loss_out', source_id: loss.id } });
  assert(lossBatchLedger?.quantity === 2000, 'batch loss ledger should exist');
  const lossStockLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'loss_out', source_id: loss.id } });
  assert(lossStockLedger?.quantity === 2000, 'product stock loss ledger should exist');
  const lossAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'inventory_loss_recorded', target_id: loss.id } });
  assert(lossAuditLog?.admin_user_id === adminUser.id, 'inventory loss audit should record admin');

  const unauthorizedStockCheck = await app.inject({ method: 'POST', url: '/api/admin/stock-checks', payload: { items: [{ batch_id: batch.id, actual_quantity: 27000 }] } });
  assert(unauthorizedStockCheck.statusCode === 401, 'stock check create should require admin session');
  const stockCheck = await adminPost('/api/admin/stock-checks', { remark: 'L14验收盘点', items: [{ batch_id: batch.id, actual_quantity: 27000, reason: '盘点差异' }] }, adminCookie);
  const confirmedStockCheck = await adminPost(`/api/admin/stock-checks/${stockCheck.id}/confirm`, {}, adminCookie);
  assert(confirmedStockCheck.status === 'confirmed', 'stock check should confirm');
  const afterCheckBatch = await prisma.productBatch.findUniqueOrThrow({ where: { id: batch.id } });
  const afterCheckProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterCheckBatch.remaining_quantity === 27000, 'stock check should adjust batch quantity');
  assert(afterCheckProduct.stock === 27000, 'stock check should adjust product stock');
  const checkBatchLedger = await prisma.batchStockLedger.findFirst({ where: { batch_id: batch.id, source_type: 'stock_check_adjust', source_id: stockCheck.id } });
  assert(checkBatchLedger?.quantity === 1000, 'stock check batch ledger should exist');
  const checkStockLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'stock_check_adjust', source_id: stockCheck.id } });
  assert(checkStockLedger?.quantity === 1000, 'stock check product ledger should exist');
  const checkAuditLog = await prisma.adminAuditLog.findFirst({ where: { action: 'stock_check_confirmed', target_id: stockCheck.id } });
  assert(checkAuditLog?.admin_user_id === adminUser.id, 'stock check confirm audit should record admin');

  const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(compliance.status === 0, 'compliance scan should pass');

  console.log('L14 batch supplier loss verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
