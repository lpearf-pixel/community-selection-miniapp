import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l16-local-verify-encryption-key';
process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l16-${Date.now()}`;
let adminHeaders: { cookie: string };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  assert(body.success, `API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function adminJson(response: Awaited<ReturnType<typeof app.inject>>) {
  return json(response);
}

async function seedPaidOrder(scope: string) {
  const name = `${prefix}-${scope}`;
  const category = await prisma.category.create({ data: { name: `${name}-category`, sort_order: 1500, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${name}-community`, address: 'L16 售后验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${name}-leader`, nickname: 'L16验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${name}-user`, nickname: 'L16售后用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${name}-坏果售后商品`,
      category_id: category.id,
      price_cents: 2000,
      cost_price_cents: 1200,
      stock: 100,
      unit: '份',
      stock_unit: 'piece',
      sale_unit: '份',
      sale_spec_name: '1份装',
      stock_deduct_quantity: 1,
      is_group_enabled: true,
      commission_type: 'percent',
      commission_value: 10,
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
      current_people: 1,
      current_quantity: 1,
      price_cents: product.price_cents,
      start_time: new Date(Date.now() - 60_000),
      end_time: new Date(Date.now() + 3_600_000),
      pickup_time: new Date(Date.now() + 7_200_000),
      status: 'success'
    }
  });
  const order = await prisma.order.create({
    data: {
      order_no: `L16${Date.now()}${scope}`,
      client_request_id: `${name}-order`,
      user_id: user.id,
      group_buy_id: groupBuy.id,
      leader_user_id: leader.id,
      total_amount_cents: product.price_cents,
      pay_amount_cents: product.price_cents,
      quantity: 1,
      pay_status: 'paid',
      order_status: 'completed',
      refund_status: 'none',
      paid_at: new Date(),
      completed_at: new Date(),
      community_id: community.id,
      receiver_name: 'L16 用户',
      receiver_phone: '13800007001'
    }
  });
  const commission = await prisma.commission.create({
    data: {
      leader_user_id: leader.id,
      order_id: order.id,
      group_buy_id: groupBuy.id,
      base_amount_cents: order.pay_amount_cents,
      commission_type: 'percent',
      commission_value: 10,
      estimated_amount_cents: 200,
      final_amount_cents: 200,
      status: 'available',
      available_at: new Date(Date.now() - 1000)
    }
  });
  return { leader, user, product, groupBuy, order, commission };
}

async function main() {
  const noLogin = await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/overview' });
  assert(noLogin.statusCode === 401, 'finance overview should require admin login');
  const noLoginCsv = await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/export.csv?type=orders' });
  assert(noLoginCsv.statusCode === 401, 'finance csv export should require admin login');

  const adminPassword = `${prefix}-AdminPass123!`;
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'operator', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');
  adminHeaders = { cookie: adminCookie };

  const primary = await seedPaidOrder('primary');
  const afterSale = await json(await app.inject({ method: 'POST', url: '/api/after-sales', payload: { order_id: primary.order.id, product_id: primary.product.id, type: 'bad_quality', reason: 'L16 partial_refund 售后', requested_refund_cents: 800 } }));
  await adminJson(await app.inject({ method: 'POST', url: `/api/admin/after-sales/${afterSale.id}/review`, headers: adminHeaders, payload: { status: 'approved', approved_refund_cents: 800, resolution_type: 'partial_refund', responsibility: 'supplier', admin_note: 'L16 审核' } }));
  const resolved = await adminJson(await app.inject({ method: 'POST', url: `/api/admin/after-sales/${afterSale.id}/resolve`, headers: adminHeaders, payload: { resolution_type: 'partial_refund', approved_refund_cents: 800, admin_note: 'L16 退款' } }));
  assert(resolved.refund_id, 'partial_refund should create refund');

  const overview = await adminJson(await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/overview', headers: adminHeaders }));
  assert(overview.paid_amount > 0, 'overview paid_amount should be positive');
  assert(overview.refunded_amount > 0, 'overview refunded_amount should be positive');
  assert(overview.net_sales_amount === overview.paid_amount - overview.refunded_amount, 'overview net_sales_amount should equal paid minus refunded');
  assert(overview.after_sale_case_count >= 1, 'overview should count after-sale cases');

  const orders = await adminJson(await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/orders', headers: adminHeaders }));
  assert(orders.items.some((item: any) => item.order_id === primary.order.id), 'orders reconciliation should include test order');

  const rewards = await adminJson(await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/rewards', headers: adminHeaders }));
  const reward = rewards.find((item: any) => item.order_id === primary.order.id);
  assert(reward, 'rewards reconciliation should include service reward');
  assert(reward.recalculated_after_refund === true && reward.related_refund_amount >= 800, 'reward should show recalculation after refund');
  const rewardText = JSON.stringify(rewards);
  for (const forbidden of [`parent_${'leader'}_id`, `up${'line'}_id`, `down${'line'}`, `team_${'id'}`, `le${'vel'} ${'commission'}`]) assert(!rewardText.includes(forbidden), `reward response should not include ${forbidden}`);

  const afterSales = await adminJson(await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/after-sales', headers: adminHeaders }));
  assert(afterSales.some((item: any) => item.after_sale_case_id === afterSale.id), 'after-sales reconciliation should include case');

  const csv = await app.inject({ method: 'GET', url: '/api/admin/finance/reconciliation/export.csv?type=orders', headers: adminHeaders });
  assert(csv.statusCode === 200, 'logged in csv export should return 200');
  assert(String(csv.headers['content-type']).includes('csv') || String(csv.headers['content-type']).includes('text/csv'), 'csv export should use csv content type');

  const scan = [
    'apps/api/src/modules/finance/finance-report-service.ts',
    'apps/api/src/routes/admin/finance.ts',
    'apps/admin/src/App.tsx'
  ].map((file) => readFileSync(file, 'utf8')).join('\n');
  for (const forbidden of [`parent_${'leader'}_id`, `up${'line'}_id`, `down${'line'}`, `team_${'id'}`, `le${'vel'} ${'commission'}`, 'AUTO_PAYOUT_ENABLED = true', 'AUTO_TAX_FILING_ENABLED = true']) assert(!scan.includes(forbidden), `compliance scan should not include ${forbidden}`);
  assert(process.env.AUTO_PAYOUT_ENABLED === 'false' && process.env.AUTO_TAX_FILING_ENABLED === 'false', 'L16 must not enable automatic payout or tax filing');

  console.log('L16 finance reconciliation verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
