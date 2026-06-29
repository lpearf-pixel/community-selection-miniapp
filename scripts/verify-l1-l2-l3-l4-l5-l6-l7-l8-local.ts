import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { releaseAvailableCommissions } from '../apps/api/src/services/commission-service.js';

const prisma = new PrismaClient();
const app = buildApp();
const stamp = Date.now();
const prefix = `l8-${stamp}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function json(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json() as { success: boolean; data: any; message: string };
  if (!body.success) throw new Error(`API failed ${response.statusCode}: ${body.message}`);
  return body.data;
}

async function post(url: string, payload: unknown) {
  return json(await app.inject({ method: 'POST', url, payload }));
}

async function expectFail(url: string, payload: unknown, expectedMessage: string) {
  const response = await app.inject({ method: 'POST', url, payload });
  const body = response.json() as { success: boolean; message: string };
  assert(body.success === false, `Expected ${url} to fail`);
  assert(body.message.includes(expectedMessage), `Expected ${expectedMessage}, got ${body.message}`);
}

async function createAvailableCommission() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1400, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L8 本地验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L8 验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L8 用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${prefix}-product`,
      category_id: category.id,
      price_cents: 2000,
      cost_price_cents: 1200,
      stock: 10,
      unit: '份',
      is_group_enabled: true,
      commission_type: 'percent',
      commission_value: 10,
      status: 'active'
    }
  });
  const groupBuy = await post('/api/group-buys', {
    product_id: product.id,
    leader_user_id: leader.id,
    community_id: community.id,
    min_people: 1,
    min_quantity: 1,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  const order = await post('/api/orders', {
    user_id: user.id,
    group_buy_id: groupBuy.id,
    client_request_id: `${prefix}-order`,
    quantity: 2,
    receiver_name: 'L8 用户',
    receiver_phone: '13800006001'
  });
  await post('/api/payments/mock', { order_id: order.id });
  await post(`/api/orders/${order.id}/status`, { next_status: 'completed' });
  const commission = await prisma.commission.findFirstOrThrow({ where: { order_id: order.id } });
  await prisma.commission.update({ where: { id: commission.id }, data: { available_at: new Date(Date.now() - 1000) } });
  await releaseAvailableCommissions();
  const available = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(available.status === 'available', `Commission should be available, got ${available.status}`);
  return { leader, order, commission: available };
}

async function main() {
  const { leader, order, commission } = await createAvailableCommission();
  const amount = commission.final_amount_cents;

  const withdrawal = await post('/api/leaders/me/withdrawals', { leader_user_id: leader.id, amount_cents: amount });
  assert(withdrawal.status === 'pending', `Withdrawal should be pending, got ${withdrawal.status}`);
  let locked = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(locked.status === 'withdrawing', `Commission should be withdrawing, got ${locked.status}`);
  assert(locked.withdrawal_id === withdrawal.id, 'Commission should be locked by withdrawal id');

  await expectFail('/api/leaders/me/withdrawals', { leader_user_id: leader.id, amount_cents: amount }, '暂无可提现开团服务奖励');
  await expectFail('/api/leaders/me/withdrawals', { leader_user_id: leader.id, amount_cents: amount + 1 }, '暂无可提现开团服务奖励');

  const rejected = await post(`/api/admin/withdrawals/${withdrawal.id}/reject`, { reason: 'L8 验收拒绝' });
  assert(rejected.status === 'rejected', `Withdrawal should be rejected, got ${rejected.status}`);
  locked = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(locked.status === 'available' && locked.withdrawal_id === null, 'Rejected withdrawal should release commission');

  await expectFail('/api/leaders/me/withdrawals', { leader_user_id: leader.id, amount_cents: amount + 1 }, '提现金额不能超过可提现余额');
  const withdrawable = await json(await app.inject({ method: 'GET', url: `/api/leaders/me/withdrawable-commissions?leader_user_id=${leader.id}` }));
  assert(withdrawable.available_amount_cents === amount, `Withdrawable amount should be ${amount}, got ${withdrawable.available_amount_cents}`);

  const secondWithdrawal = await post('/api/leaders/me/withdrawals', { leader_user_id: leader.id, amount_cents: amount });
  const approved = await post(`/api/admin/withdrawals/${secondWithdrawal.id}/approve`, { reason: 'L8 验收通过' });
  assert(approved.status === 'approved', `Withdrawal should be approved, got ${approved.status}`);
  let afterApprove = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(afterApprove.status === 'withdrawing', `Commission should remain withdrawing after approve, got ${afterApprove.status}`);

  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 50,
    reason: 'L8 验收审核通过未处理退款告警',
    client_refund_id: `${prefix}-refund-during-approved`
  });
  const reviewAlert = await prisma.opsAlertLog.findFirstOrThrow({ where: { order_id: order.id, alert_type: 'refund_during_withdrawal_review' } });
  assert(reviewAlert.status === 'open', 'Refund during approved withdrawal should create review alert');
  const noWithdrawnAlertCount = await prisma.opsAlertLog.count({ where: { order_id: order.id, alert_type: 'refund_after_withdrawn' } });
  assert(noWithdrawnAlertCount === 0, 'Approved but not paid withdrawal should not create refund_after_withdrawn alert');

  const paid = await post(`/api/admin/withdrawals/${secondWithdrawal.id}/mark-paid`, { reason: 'L8 验收人工标记已处理' });
  assert(paid.status === 'paid', `Withdrawal should be paid after mark-paid, got ${paid.status}`);
  const withdrawn = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
  assert(withdrawn.status === 'withdrawn', `Commission should be withdrawn after mark-paid, got ${withdrawn.status}`);

  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 50,
    reason: 'L8 验收提现后退款告警',
    client_refund_id: `${prefix}-refund-after-withdrawn`
  });
  const alert = await prisma.opsAlertLog.findFirstOrThrow({ where: { order_id: order.id, alert_type: 'refund_after_withdrawn' } });
  assert(alert.status === 'open', 'Refund after withdrawn should create alert');

  const withdrawalEvents = await prisma.businessEventLog.findMany({ where: { withdrawal_id: secondWithdrawal.id } });
  assert(withdrawalEvents.some((item) => item.event_type === 'withdrawal_requested'), 'withdrawal_requested event should exist');
  assert(withdrawalEvents.some((item) => item.event_type === 'withdrawal_approved'), 'withdrawal_approved event should exist');
  const aiContext = await json(await app.inject({ method: 'GET', url: `/api/admin/logs/orders/${order.id}/ai-context` }));
  assert(aiContext.business_events.some((item: { event_type: string }) => item.event_type === 'withdrawal_approved'), 'AI context should include withdrawal event');
  assert(aiContext.alerts.some((item: { alert_type: string }) => item.alert_type === 'refund_after_withdrawn'), 'AI context should include refund after withdrawn alert');

  const leaderWithdrawals = await json(await app.inject({ method: 'GET', url: `/api/leaders/me/withdrawals?leader_user_id=${leader.id}` }));
  assert(leaderWithdrawals.length >= 2, 'Leader withdrawal list should be available');
  const adminWithdrawals = await json(await app.inject({ method: 'GET', url: '/api/admin/withdrawals' }));
  assert(adminWithdrawals.some((item: { id: string }) => item.id === secondWithdrawal.id), 'Admin withdrawal list should include withdrawal');

  console.log('L1/L2/L3/L4/L5/L6/L7/L8 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
