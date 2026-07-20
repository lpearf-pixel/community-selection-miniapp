import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { hashPassword } from '../apps/api/src/services/admin-auth-service.js';

process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? 'l15-local-verify-encryption-key';
process.env.WECHAT_PAY_MODE = 'mock';
process.env.MOCK_WECHAT_PAY = 'true';
process.env.AUTO_PAYOUT_ENABLED = 'false';
process.env.AUTO_TAX_FILING_ENABLED = 'false';

const prisma = new PrismaClient();
const app = buildApp();
const prefix = `l15-${Date.now()}`;
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
  const community = await prisma.community.create({ data: { name: `${name}-community`, address: 'L15 售后验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${name}-leader`, nickname: 'L15验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${name}-user`, nickname: 'L15售后用户', role: 'customer', status: 'active' } });
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
      order_no: `L15${Date.now()}${scope}`,
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
      receiver_name: 'L15 用户',
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
  const adminPassword = `${prefix}-AdminPass123!`;
  const adminUser = await prisma.adminUser.create({ data: { username: `${prefix}-admin`, password_hash: await hashPassword(adminPassword), role: 'super_admin', status: 'active' } });
  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username: adminUser.username, password: adminPassword } });
  assert(login.statusCode === 200, 'admin login should succeed');
  const setCookie = login.headers['set-cookie'];
  const adminCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert(typeof adminCookie === 'string' && adminCookie.includes('admin_session='), 'admin login should set session cookie');
  adminHeaders = { cookie: adminCookie };

  const primary = await seedPaidOrder('primary');
  const submitPayload = {
    order_id: primary.order.id,
    product_id: primary.product.id,
    type: 'bad_quality',
    reason: '叶菜坏果',
    description: '收到时已有明显腐烂',
    requested_refund_cents: 2000,
    evidence_image_urls: ['https://example.com/l15-after-sale.jpg']
  };

  const afterSale = await json(await app.inject({ method: 'POST', url: '/api/after-sales', payload: submitPayload }));
  assert(afterSale.status === 'submitted' && afterSale.type === 'bad_quality', 'after-sale case should be submitted');

  const duplicate = await app.inject({ method: 'POST', url: '/api/after-sales', payload: submitPayload });
  assert(duplicate.statusCode === 400, 'duplicate active after-sale should be rejected');

  const overLimit = await seedPaidOrder('over-limit-total-only');
  const overLimitResponse = await app.inject({
    method: 'POST',
    url: '/api/after-sales',
    payload: {
      order_id: overLimit.order.id,
      product_id: overLimit.product.id,
      type: 'bad_quality',
      reason: '总申请金额超过剩余可退金额',
      requested_refund_cents: 2001,
    },
  });
  assert(overLimitResponse.statusCode === 400, 'total-only over-limit after-sale must be rejected');
  assert(
    !(await prisma.afterSaleCase.findFirst({ where: { order_id: overLimit.order.id } })),
    'total-only over-limit after-sale must not create a case',
  );

  const list = await json(await app.inject({ method: 'GET', url: `/api/after-sales?order_id=${primary.order.id}` }));
  assert(list.some((item: any) => item.id === afterSale.id), 'public after-sale list should include submitted case');
  const detail = await json(await app.inject({ method: 'GET', url: `/api/after-sales/${afterSale.id}` }));
  assert(detail.logs.some((item: any) => item.action === 'after_sale_submitted'), 'after-sale detail should include submit log');

  const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/after-sales' });
  assert(unauthorized.statusCode === 401, 'admin after-sale API should require admin token');

  const adminList = await adminJson(await app.inject({ method: 'GET', url: '/api/admin/after-sales', headers: adminHeaders }));
  assert(adminList.some((item: any) => item.id === afterSale.id), 'admin list should include after-sale case');
  const adminDetail = await adminJson(await app.inject({ method: 'GET', url: `/api/admin/after-sales/${afterSale.id}`, headers: adminHeaders }));
  assert(adminDetail.id === afterSale.id, 'admin detail should load after-sale case');

  const reviewed = await adminJson(await app.inject({
    method: 'POST',
    url: `/api/admin/after-sales/${afterSale.id}/review`,
    headers: adminHeaders,
    payload: { status: 'approved', approved_refund_cents: 800, resolution_type: 'partial_refund', responsibility: 'supplier', admin_note: '按坏果比例部分退款' }
  }));
  assert(
    reviewed.status === 'approved' &&
      reviewed.approved_refund_cents === 800 &&
      reviewed.approved_refund_cents < afterSale.requested_refund_cents,
    'admin should be able to approve less than the requested full amount',
  );

  const resolved = await adminJson(await app.inject({
    method: 'POST',
    url: `/api/admin/after-sales/${afterSale.id}/resolve`,
    headers: adminHeaders,
    payload: { resolution_type: 'partial_refund', approved_refund_cents: 800, admin_note: '售后退款已处理' }
  }));
  assert(resolved.status === 'resolved' && resolved.refund_id, 'after-sale resolve should create refund and mark resolved');

  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: resolved.refund_id } });
  assert(refund.status === 'success' && refund.refund_amount_cents === 800, 'after-sale refund should reuse mock refund flow');
  const refundedOrder = await prisma.order.findUniqueOrThrow({ where: { id: primary.order.id } });
  assert(refundedOrder.refund_status === 'success' && refundedOrder.refund_amount_cents === 800, 'order refund status should reflect after-sale refund');
  const adjustedCommission = await prisma.commission.findUniqueOrThrow({ where: { id: primary.commission.id } });
  assert(adjustedCommission.final_amount_cents === 120 && adjustedCommission.deduct_amount_cents === 80, 'commission should be recalculated after after-sale refund');

  const aiContext = await adminJson(await app.inject({ method: 'GET', url: `/api/admin/logs/orders/${primary.order.id}/ai-context`, headers: adminHeaders }));
  const aiEventTypes = aiContext.business_events.map((item: any) => item.event_type);
  assert(aiEventTypes.includes('after_sale_submitted'), 'AI context should include after_sale_submitted');
  assert(aiEventTypes.includes('after_sale_refund_created') || aiEventTypes.includes('after_sale_resolved'), 'AI context should include after-sale resolution event');

  const beforeStock = (await prisma.product.findUniqueOrThrow({ where: { id: primary.product.id } })).stock;
  const linkedLoss = await adminJson(await app.inject({
    method: 'POST',
    url: `/api/admin/after-sales/${afterSale.id}/link-loss`,
    headers: adminHeaders,
    payload: { product_id: primary.product.id, quantity: 2, reason: 'after_sale_bad_quality', remark: '售后坏果损耗' }
  }));
  assert(linkedLoss.inventory_loss_id, 'after-sale should link inventory loss');
  const loss = await prisma.inventoryLoss.findUniqueOrThrow({ where: { id: linkedLoss.inventory_loss_id } });
  assert(loss.quantity === 2 && loss.product_id === primary.product.id, 'inventory loss should be created for after-sale');
  const afterStock = (await prisma.product.findUniqueOrThrow({ where: { id: primary.product.id } })).stock;
  assert(afterStock === beforeStock - 2, 'product stock should decrease after after-sale loss link');
  const lossEvent = await prisma.businessEventLog.findFirst({ where: { order_id: primary.order.id, event_type: 'after_sale_loss_linked' } });
  assert(lossEvent, 'business event should include after_sale_loss_linked');

  const cancellable = await seedPaidOrder('cancel');
  const cancelCase = await json(await app.inject({ method: 'POST', url: '/api/after-sales', payload: { order_id: cancellable.order.id, product_id: cancellable.product.id, type: 'missing_item', reason: '漏发一份', requested_refund_cents: 500 } }));
  const cancelled = await json(await app.inject({ method: 'POST', url: `/api/after-sales/${cancelCase.id}/cancel` }));
  assert(cancelled.status === 'cancelled', 'submitted after-sale should be cancellable');

  const nonCancellable = await seedPaidOrder('reject');
  const rejectCase = await json(await app.inject({ method: 'POST', url: '/api/after-sales', payload: { order_id: nonCancellable.order.id, product_id: nonCancellable.product.id, type: 'wrong_item', reason: '错发商品', requested_refund_cents: 300 } }));
  await adminJson(await app.inject({ method: 'POST', url: `/api/admin/after-sales/${rejectCase.id}/review`, headers: adminHeaders, payload: { status: 'rejected', resolution_type: 'reject', responsibility: 'customer', admin_note: '凭证不足' } }));
  const rejectedCancel = await app.inject({ method: 'POST', url: `/api/after-sales/${rejectCase.id}/cancel` });
  assert(rejectedCancel.statusCode === 400, 'rejected after-sale should not be cancellable');

  assert(process.env.AUTO_PAYOUT_ENABLED === 'false' && process.env.AUTO_TAX_FILING_ENABLED === 'false', 'after-sale verification must not enable automatic payout or tax filing');

  console.log('L15 after-sale verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
