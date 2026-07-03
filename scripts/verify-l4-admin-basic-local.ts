import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l4-local-verify-encryption-key';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l4-${Date.now()}`;
const receiverPhone = '13812345678';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1400, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L4 独立验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader-openid`, nickname: 'L4 验收开团人', role: 'leader', status: 'active' } });
  const customer = await prisma.user.create({ data: { openid: `${prefix}-customer-openid`, nickname: 'L4 验收用户', role: 'customer', status: 'active' } });
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

  const groupBuy = await json(await app.inject({ method: 'POST', url: '/api/group-buys', payload: {
    product_id: product.id,
    leader_user_id: leader.id,
    community_id: community.id,
    min_people: 1,
    min_quantity: 1,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  } }));
  assert(groupBuy.product_id === product.id, 'group buy product_id should match');
  assert(groupBuy.leader_user_id === leader.id, 'group buy leader_user_id should match');
  assert(groupBuy.community_id === community.id, 'group buy community_id should match');
  assert(groupBuy.status === 'pending', `group buy should start as pending, got ${groupBuy.status}`);

  const groupBuys = await json(await app.inject({ method: 'GET', url: '/api/group-buys' }));
  const listedGroupBuy = groupBuys.find((item: any) => item.id === groupBuy.id);
  assert(listedGroupBuy?.product?.id === product.id, 'group buy list should include product');
  assert(listedGroupBuy?.community?.id === community.id, 'group buy list should include community');
  assert(listedGroupBuy?.leader_user?.id === leader.id, 'group buy list should include leader_user');

  const groupBuyDetail = await json(await app.inject({ method: 'GET', url: `/api/group-buys/${groupBuy.id}` }));
  assert(groupBuyDetail.id === groupBuy.id, 'group buy detail id should match');
  assert(Array.isArray(groupBuyDetail.orders), 'group buy detail should include orders');

  const order = await json(await app.inject({ method: 'POST', url: '/api/orders', payload: {
    user_id: customer.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order`,
    quantity: 2,
    receiver_name: 'L4 验收用户',
    receiver_phone: receiverPhone
  } }));
  assert(order.quantity === 2, 'order quantity should keep sale quantity');
  assert(order.group_buy_id === groupBuy.id, 'order group_buy_id should match');
  assert(order.user_id === customer.id, 'order user_id should match');
  const afterOrderProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert(afterOrderProduct.stock === 45000, `product stock should be 45000, got ${afterOrderProduct.stock}`);
  const orderLockLedger = await prisma.stockLedger.findFirst({ where: { product_id: product.id, source_type: 'order_lock', source_id: order.id } });
  assert(orderLockLedger?.quantity === 5000, 'order_lock stock ledger should record 5000 base units');

  const orders = await json(await app.inject({ method: 'GET', url: '/api/orders' }));
  const listedOrder = orders.find((item: any) => item.id === order.id);
  assert(listedOrder?.group_buy?.product?.id === product.id, 'order list should include group_buy.product');
  assert(listedOrder?.group_buy?.community?.id === community.id, 'order list should include group_buy.community');
  assert(listedOrder?.user?.id === customer.id, 'order list should include user');

  const orderDetail = await json(await app.inject({ method: 'GET', url: `/api/orders/${order.id}` }));
  assert(orderDetail.order_no === order.order_no, 'order detail order_no should match');
  assert(orderDetail.receiver_name === 'L4 验收用户', 'order detail receiver_name should match');

  const paidResult = await json(await app.inject({ method: 'POST', url: '/api/payments/mock', payload: { order_id: order.id } }));
  assert(paidResult.order.pay_status === 'paid', 'mock payment should mark order paid');
  assert(['paid', 'grouped'].includes(paidResult.order.order_status), `mock payment should move order to paid or grouped before fulfillment, got ${paidResult.order.order_status}`);

  for (const nextStatus of ['preparing', 'ready', 'picked', 'completed']) {
    const updated = await json(await app.inject({ method: 'POST', url: `/api/orders/${order.id}/status`, payload: { next_status: nextStatus } }));
    assert(updated.order_status === nextStatus, `order status should move to ${nextStatus}`);
    if (nextStatus === 'completed') assert(updated.completed_at, 'completed order should have completed_at');
  }
  const timelineCount = await prisma.orderTimelineLog.count({ where: { order_id: order.id, event_type: { in: ['order_status_changed', 'order_completed'] } } });
  assert(timelineCount >= 4, 'order timeline should include status changes and completion');
  const businessEventCount = await prisma.businessEventLog.count({ where: { order_id: order.id, event_type: { in: ['order_status_changed', 'order_completed'] } } });
  assert(businessEventCount >= 4, 'business events should include status changes and completion');

  const publicCsv = await app.inject({ method: 'GET', url: '/api/orders/export/picking.csv?format=detail' });
  assert(publicCsv.statusCode === 200, 'public picking csv should return 200');
  assert(publicCsv.body.includes(order.order_no), 'public picking csv should include order_no');
  assert(publicCsv.body.includes('L4 验收用户'), 'public picking csv should include receiver_name');
  assert(publicCsv.body.includes('138****5678'), 'public picking csv should mask receiver phone');
  assert(!publicCsv.body.includes(receiverPhone), 'public picking csv should not include full phone');
  assert(!publicCsv.body.includes('openid') && !publicCsv.body.includes('unionid'), 'public picking csv should not include openid or unionid');

  const unauthorizedAdminCsv = await app.inject({ method: 'GET', url: '/api/admin/orders/export/picking.csv?format=detail' });
  assert(unauthorizedAdminCsv.statusCode === 401, 'admin picking csv should require admin session');
  const adminPassword = `${prefix}-AdminPass123!`;
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'operator', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');
  const adminCsv = await app.inject({ method: 'GET', url: '/api/admin/orders/export/picking.csv?format=detail', headers: { cookie: adminCookie } });
  assert(adminCsv.statusCode === 200, 'admin picking csv should return 200 with session');
  assert(adminCsv.body.includes(order.order_no), 'admin picking csv should include order_no');
  assert(adminCsv.body.includes('138****5678'), 'admin picking csv should mask receiver phone');
  assert(!adminCsv.body.includes(receiverPhone), 'admin picking csv should not include full phone');

  const adminAppSource = readFileSync('apps/admin/src/App.tsx', 'utf8');
  for (const text of ['商品管理', '团购管理', '订单管理', '导出明细分拣单 CSV', '导出汇总分拣单 CSV', '备货中', '待自提', '已自提', '完成']) {
    assert(adminAppSource.includes(text), `admin app should include ${text}`);
  }

  const compliance = spawnSync('pnpm', ['exec', 'tsx', 'scripts/compliance-scan.ts'], { stdio: 'inherit' });
  assert(compliance.status === 0, 'compliance scan should pass');

  console.log('L4 admin basic verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
