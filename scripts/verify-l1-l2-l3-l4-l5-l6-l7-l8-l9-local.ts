import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l9-${Date.now()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function source(path: string) {
  return readFileSync(path, 'utf8');
}

function runComplianceScan() {
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(result.status === 0, 'compliance scan should pass');
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

function assertAdminEnhancements() {
  const adminSource = source('apps/admin/src/App.tsx');
  assert(adminSource.includes('withdrawals') && adminSource.includes('alerts') && adminSource.includes('taxRecords'), 'admin should include L9 views');
  assert(adminSource.includes('/api/admin/logs/orders/'), 'admin order detail should load AI context');
  assert(adminSource.includes('/api/admin/withdrawals'), 'admin should load withdrawals');
  assert(adminSource.includes('/api/admin/tax-records'), 'admin should load tax records');
  assert(adminSource.includes('/api/admin/logs/alerts'), 'admin should load alerts');
  assert(adminSource.includes("updateAlert(item, 'resolve')"), 'admin should resolve alerts');
  assert(adminSource.includes("updateAlert(item, 'ignore')"), 'admin should ignore alerts');
  assert(adminSource.includes('tax_mode') && adminSource.includes('tax_status') && adminSource.includes('payable_amount_cents') && adminSource.includes('invoice_status'), 'withdrawal table should expose tax fields');
  assert(!adminSource.includes('/api/orders/${order.id}/complete'), 'admin should not call legacy order complete endpoint');
  assert(adminSource.includes('/api/orders/${order.id}/status'), 'admin should call order status endpoint');
}

function assertBackendRoutes() {
  const withdrawalRoutes = source('apps/api/src/routes/withdrawals.ts');
  const logsRoutes = source('apps/api/src/routes/logs.ts');
  assert(withdrawalRoutes.includes('/api/admin/withdrawals/:id/tax-review'), 'tax review route should exist');
  assert(withdrawalRoutes.includes('/api/admin/tax-records'), 'tax records route should exist');
  assert(logsRoutes.includes('/api/admin/logs/orders/:order_id/ai-context'), 'AI context route should exist');
}

async function assertAdminApis() {
  const alertList = await json(await app.inject({ method: 'GET', url: '/api/admin/logs/alerts' }));
  assert(Array.isArray(alertList), 'alerts API should return an array');

  const taxRecords = await json(await app.inject({ method: 'GET', url: '/api/admin/tax-records' }));
  assert(Array.isArray(taxRecords), 'tax records API should return an array');

  const resolveAlert = await prisma.opsAlertLog.create({
    data: {
      alert_type: 'refund_after_withdrawn',
      alert_level: 'critical',
      status: 'open',
      title: 'L9 resolve alert',
      message: 'L9 local verification alert'
    }
  });
  const resolved = await json(await app.inject({
    method: 'POST',
    url: `/api/admin/logs/alerts/${resolveAlert.id}/resolve`,
    payload: { resolved_by: 'admin', resolution_note: 'L9 验收处理' }
  }));
  assert(resolved.status === 'resolved', `alert should be resolved, got ${resolved.status}`);

  const ignoreAlert = await prisma.opsAlertLog.create({
    data: {
      alert_type: 'refund_during_withdrawal_review',
      alert_level: 'warning',
      status: 'open',
      title: 'L9 ignore alert',
      message: 'L9 local verification alert'
    }
  });
  const ignored = await json(await app.inject({
    method: 'POST',
    url: `/api/admin/logs/alerts/${ignoreAlert.id}/ignore`,
    payload: { resolved_by: 'admin', resolution_note: 'L9 验收忽略' }
  }));
  assert(ignored.status === 'ignored', `alert should be ignored, got ${ignored.status}`);
}

async function assertAiContext() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1900, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L9 验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L9 开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L9 用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${prefix}-product`,
      category_id: category.id,
      price_cents: 1000,
      cost_price_cents: 600,
      stock: 10,
      unit: '份',
      is_group_enabled: true,
      status: 'active'
    }
  });
  const groupBuy = await prisma.groupBuy.create({
    data: {
      product_id: product.id,
      leader_user_id: leader.id,
      community_id: community.id,
      min_people: 1,
      min_quantity: 1,
      price_cents: product.price_cents,
      start_time: new Date(),
      end_time: new Date(Date.now() + 60 * 60 * 1000),
      pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000),
      status: 'pending'
    }
  });
  const order = await prisma.order.create({
    data: {
      order_no: `${prefix}-order-no`,
      client_request_id: `${prefix}-order-request`,
      user_id: user.id,
      group_buy_id: groupBuy.id,
      leader_user_id: leader.id,
      total_amount_cents: 1000,
      pay_amount_cents: 1000,
      quantity: 1,
      pay_status: 'paid',
      order_status: 'paid',
      receiver_name: 'L9 用户',
      receiver_phone: '13800009000'
    }
  });
  await prisma.orderTimelineLog.create({ data: { order_id: order.id, event_type: 'order_created', title: '订单已创建' } });
  await prisma.businessEventLog.create({ data: { event_type: 'payment_mark_order_paid', event_source: 'l9-verifier', order_id: order.id, user_id: user.id } });
  await prisma.opsAlertLog.create({ data: { alert_type: 'refund_after_withdrawn', alert_level: 'critical', status: 'open', order_id: order.id, title: 'L9 AI context alert', message: 'L9 local verification alert' } });

  const context = await json(await app.inject({ method: 'GET', url: `/api/admin/logs/orders/${order.id}/ai-context` }));
  assert(context.order.id === order.id, 'AI context should include order');
  assert(Array.isArray(context.timeline), 'AI context should include timeline');
  assert(Array.isArray(context.business_events), 'AI context should include business events');
  assert(Array.isArray(context.alerts), 'AI context should include alerts');
  assert(Array.isArray(context.suggested_focus), 'AI context should include suggested focus');
}

async function main() {
  runComplianceScan();
  assertAdminEnhancements();
  assertBackendRoutes();
  await assertAdminApis();
  await assertAiContext();
  console.log('L1-L9 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
