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
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l12-local-verify-encryption-key';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l12-${Date.now()}`;

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
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'admin', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');

  const category = await prisma.category.create({ data: { name: `${prefix}-cat` } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'community address' } });
  const store = await prisma.pickupStore.create({ data: { name: `${prefix}-store`, address: 'store address', phone: '13800000000' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L12开团人', role: 'leader' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L12用户', role: 'customer' } });
  const product = await prisma.product.create({ data: { name: `${prefix}-product`, category_id: category.id, price_cents: 1200, cost_price_cents: 800, stock: 100, unit: '份', is_group_enabled: true, status: 'active', commission_type: 'fixed', commission_value: 100 } });
  const pickupTime = new Date(Date.now() + 7200_000);
  const groupBuy = await post('/api/group-buys', { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, end_time: new Date(Date.now() + 3600_000).toISOString(), pickup_time: pickupTime.toISOString() });
  const order = await consumerPost('/api/orders', user.id, { group_buy_id: groupBuy.id, client_request_id: `${prefix}-order`, quantity: 2, pickup_store_id: store.id, receiver_name: '张三', receiver_phone: '13812345678' });
  await post('/api/payments/mock', { order_id: order.id });
  const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const ready = await adminPost(`/api/admin/orders/${order.id}/status`, {
    next_status: 'ready',
    expected_version: paidOrder.version,
    idempotency_key: `${prefix}-ready`,
  }, adminCookie);

  const overviewDate = pickupTime.toISOString().slice(0, 10);
  const overview = await json(await adminGet(`/api/admin/fulfillment/overview?date=${overviewDate}`, adminCookie));
  assert(overview.by_community.some((item: any) => item.community_id === community.id && item.quantity >= 2), 'overview should include community quantity');
  assert(overview.by_product.some((item: any) => item.product_id === product.id && item.quantity >= 2), 'overview should include product quantity');

  const unauthorizedCsv = await app.inject({ method: 'GET', url: '/api/admin/orders/export/picking.csv?format=detail' });
  assert(unauthorizedCsv.statusCode === 401, 'admin picking csv should require a session cookie');
  const detailCsv = await adminGet('/api/admin/orders/export/picking.csv?format=detail', adminCookie);
  assert(detailCsv.statusCode === 200, 'detail csv should export');
  assert(detailCsv.body.includes(order.order_no), 'detail csv should include order_no');
  assert(detailCsv.body.includes('138****5678'), 'detail csv should mask phone');
  assert(!detailCsv.body.includes('13812345678'), 'detail csv should not include full phone');
  const summaryCsv = await adminGet('/api/admin/orders/export/picking.csv?format=summary', adminCookie);
  assert(summaryCsv.statusCode === 200 && summaryCsv.body.includes('total_quantity'), 'summary csv should export quantity summary');

  const pickupCommand = {
    expected_version: ready.version,
    idempotency_key: `${prefix}-pickup`,
    admin_remark: '用户已自提',
  };
  const picked = await adminPost(`/api/admin/orders/${order.id}/pickup-verify`, pickupCommand, adminCookie);
  assert(picked.order_status === 'picked', 'ready order should become picked');
  const pickedAgain = await adminPost(`/api/admin/orders/${order.id}/pickup-verify`, pickupCommand, adminCookie);
  assert(pickedAgain.order_status === 'picked', 'same pickup command should replay idempotently');

  const closedOrder = await prisma.order.create({ data: { order_no: `${prefix}-closed`, user_id: user.id, leader_user_id: leader.id, group_buy_id: groupBuy.id, total_amount_cents: 100, pay_amount_cents: 100, quantity: 1, receiver_name: '李四', receiver_phone: '13912345678', order_status: 'closed', pay_status: 'closed' } });
  const closedVerify = await app.inject({
    method: 'POST',
    url: `/api/admin/orders/${closedOrder.id}/pickup-verify`,
    payload: {
      expected_version: closedOrder.version,
      idempotency_key: `${prefix}-closed-pickup`,
      admin_remark: '不可核销',
    },
    headers: { cookie: adminCookie },
  });
  assert(closedVerify.statusCode === 409, 'closed order should not pickup-verify');

  const [timeline, businessEvent, auditLog] = await Promise.all([
    prisma.orderTimelineLog.findFirst({ where: { order_id: order.id, event_type: 'pickup_verified' } }),
    prisma.businessEventLog.findFirst({ where: { order_id: order.id, event_type: 'pickup_verified' } }),
    prisma.adminAuditLog.findFirst({ where: { target_id: order.id, action: 'order_pickup_verified' } })
  ]);
  assert(timeline && businessEvent && auditLog, 'pickup verify should write timeline, business event and admin audit');

  const dashboard = await json(
    await app.inject({
      method: 'GET',
      url: '/api/leaders/me/dashboard',
      headers: { 'x-user-id': leader.id },
    }),
  );
  assert(dashboard.total_orders >= 1 && dashboard.total_amount_cents >= 0, 'leader dashboard should aggregate orders and amount');
  assert('available_commission_cents' in dashboard && 'converted_credit_cents' in dashboard, 'leader dashboard should include commission fields');

  const unauthorizedClone = await app.inject({ method: 'POST', url: `/api/admin/group-buys/${groupBuy.id}/clone`, payload: { end_time: new Date(Date.now() + 86_400_000).toISOString(), pickup_time: new Date(Date.now() + 172_800_000).toISOString() } });
  assert(unauthorizedClone.statusCode === 401, 'admin clone should require a session cookie');
  const cloned = await adminPost(`/api/admin/group-buys/${groupBuy.id}/clone`, { end_time: new Date(Date.now() + 86_400_000).toISOString(), pickup_time: new Date(Date.now() + 172_800_000).toISOString() }, adminCookie);
  assert(cloned.id !== groupBuy.id && cloned.status === 'pending', 'admin clone should create a new pending group buy');
  const clonedWithOrders = await prisma.groupBuy.findUnique({ where: { id: cloned.id }, include: { orders: true } });
  assert(clonedWithOrders?.orders.length === 0, 'clone should not copy orders');
  const cloneAuditLog = await prisma.adminAuditLog.findFirst({ where: { target_id: cloned.id, action: 'group_buy_cloned' } });
  assert(cloneAuditLog?.admin_user_id === adminUser.id, 'admin clone audit log should record current admin user');

  const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(compliance.status === 0, 'compliance scan should pass');

  console.log('L12 fulfillment verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
