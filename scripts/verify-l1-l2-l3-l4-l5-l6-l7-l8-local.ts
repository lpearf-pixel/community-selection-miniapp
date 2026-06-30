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

async function createAvailableCommission(scope = 'withdraw') {
  const name = `${prefix}-${scope}`;
  const category = await prisma.category.create({ data: { name: `${name}-category`, sort_order: 1400, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${name}-community`, address: 'L8 本地验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${name}-leader`, nickname: 'L8 验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${name}-user`, nickname: 'L8 用户', role: 'customer', status: 'active' } });
  const product = await prisma.product.create({
    data: {
      name: `${name}-product`,
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
    client_request_id: `${name}-order`,
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
  const { leader: convertLeader, commission: convertCommission } = await createAvailableCommission('convert');
  const convertAmount = convertCommission.final_amount_cents;
  const conversionResult = await post('/api/leaders/me/rewards/convert-credit', {
    leader_user_id: convertLeader.id,
    commission_ids: [convertCommission.id],
    amount_cents: convertAmount,
    client_request_id: `${prefix}-convert-credit`
  });
  assert(conversionResult.conversion.status === 'success', 'Reward conversion should succeed');
  const convertedCommission = await prisma.commission.findUniqueOrThrow({ where: { id: convertCommission.id } });
  assert(convertedCommission.status === 'converted', `Commission should be converted, got ${convertedCommission.status}`);
  const conversionTax = await prisma.taxRecord.findUniqueOrThrow({ where: { id: conversionResult.tax_record.id } });
  assert(conversionTax.tax_status === 'pending_review', 'Tax status should stay pending_review');
  const creditIn = await prisma.consumerCreditLedger.findFirstOrThrow({ where: { user_id: convertLeader.id, source_type: 'reward_conversion', source_id: conversionResult.conversion.id } });
  assert(creditIn.balance_after_cents === convertAmount, 'Consumer credit balance should increase');

  const creditCategory = await prisma.category.create({ data: { name: `${prefix}-credit-category`, sort_order: 1410, status: 'active' } });
  const creditCommunity = await prisma.community.create({ data: { name: `${prefix}-credit-community`, address: 'L8 消费额度社区', status: 'active' } });
  const creditProduct = await prisma.product.create({
    data: {
      name: `${prefix}-credit-product`,
      category_id: creditCategory.id,
      price_cents: convertAmount + 100,
      cost_price_cents: 50,
      stock: 5,
      unit: '份',
      is_group_enabled: true,
      commission_type: 'none',
      commission_value: 0,
      status: 'active'
    }
  });
  const creditGroupBuy = await post('/api/group-buys', {
    product_id: creditProduct.id,
    leader_user_id: convertLeader.id,
    community_id: creditCommunity.id,
    min_people: 1,
    min_quantity: 1,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  const creditOrder = await post('/api/orders', {
    user_id: convertLeader.id,
    group_buy_id: creditGroupBuy.id,
    client_request_id: `${prefix}-credit-order`,
    quantity: 1,
    receiver_name: 'L8 用户',
    receiver_phone: '13800006002',
    credit_amount_cents: convertAmount,
    credit_source_id: conversionResult.conversion.id
  });
  assert(creditOrder.credit_amount_cents === convertAmount, 'Order should record credit amount');
  assert(creditOrder.credit_source_type === 'reward_conversion', 'Order should record credit source type');
  await post('/api/payments/mock', { order_id: creditOrder.id });
  await post('/api/refunds/mock', {
    order_id: creditOrder.id,
    refund_amount_cents: creditOrder.pay_amount_cents,
    reason: 'L8 消费额度订单退款',
    client_refund_id: `${prefix}-credit-order-refund`
  });
  const creditBack = await prisma.consumerCreditLedger.findFirstOrThrow({ where: { user_id: convertLeader.id, source_type: 'order_refund', source_id: creditOrder.id } });
  assert(creditBack.amount_cents === convertAmount, 'Credit refund should return credit amount');
  await post('/api/refunds/mock', {
    order_id: creditOrder.id,
    refund_amount_cents: creditOrder.pay_amount_cents,
    reason: 'L8 消费额度订单退款重复请求',
    client_refund_id: `${prefix}-credit-order-refund`
  });
  const creditReturnCount = await prisma.consumerCreditLedger.count({ where: { user_id: convertLeader.id, source_type: 'order_refund', source_id: creditOrder.id } });
  assert(creditReturnCount === 1, 'Repeated refund should not return credit twice');
  const creditAiContext = await json(await app.inject({ method: 'GET', url: `/api/admin/logs/orders/${creditOrder.id}/ai-context` }));
  assert(creditAiContext.credit_usage.from_reward_conversion === true, 'AI context should recognize reward conversion credit');
  assert(creditAiContext.credit_usage.tax_status === 'pending_review', 'AI context should expose tax status');
  assert(creditAiContext.suggested_focus.includes('核查该消费额度来源及税务状态'), 'AI context should suggest credit source review');

  const { leader: partialLeader, commission: partialCommission } = await createAvailableCommission('convert-partial');
  const partialAmount = partialCommission.final_amount_cents;
  const partialConversion = await post('/api/leaders/me/rewards/convert-credit', {
    leader_user_id: partialLeader.id,
    commission_ids: [partialCommission.id],
    amount_cents: partialAmount,
    client_request_id: `${prefix}-convert-credit-partial`
  });
  const partialCategory = await prisma.category.create({ data: { name: `${prefix}-partial-credit-category`, sort_order: 1420, status: 'active' } });
  const partialCommunity = await prisma.community.create({ data: { name: `${prefix}-partial-credit-community`, address: 'L8 消费额度部分退款社区', status: 'active' } });
  const partialProduct = await prisma.product.create({
    data: {
      name: `${prefix}-partial-credit-product`,
      category_id: partialCategory.id,
      price_cents: partialAmount + 100,
      cost_price_cents: 50,
      stock: 5,
      unit: '份',
      is_group_enabled: true,
      commission_type: 'none',
      commission_value: 0,
      status: 'active'
    }
  });
  const partialGroupBuy = await post('/api/group-buys', {
    product_id: partialProduct.id,
    leader_user_id: partialLeader.id,
    community_id: partialCommunity.id,
    min_people: 1,
    min_quantity: 1,
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  const partialCreditOrder = await post('/api/orders', {
    user_id: partialLeader.id,
    group_buy_id: partialGroupBuy.id,
    client_request_id: `${prefix}-partial-credit-order`,
    quantity: 1,
    receiver_name: 'L8 用户',
    receiver_phone: '13800006003',
    credit_amount_cents: partialAmount,
    credit_source_id: partialConversion.conversion.id
  });
  await post('/api/payments/mock', { order_id: partialCreditOrder.id });
  await post('/api/refunds/mock', {
    order_id: partialCreditOrder.id,
    refund_amount_cents: 50,
    reason: 'L8 消费额度订单部分退款',
    client_refund_id: `${prefix}-partial-credit-refund`
  });
  const partialCreditReturnCount = await prisma.consumerCreditLedger.count({ where: { user_id: partialLeader.id, source_type: 'order_refund', source_id: partialCreditOrder.id } });
  assert(partialCreditReturnCount === 0, 'Partial refund should not return credit in first version');
  const partialCreditWarning = await prisma.businessEventLog.findFirstOrThrow({ where: { order_id: partialCreditOrder.id, event_type: 'reward_credit_partial_refund_skipped' } });
  assert(partialCreditWarning.event_level === 'warning', 'Partial credit refund skip should create warning event');

  const { leader, order, commission } = await createAvailableCommission('withdraw');
  const amount = commission.final_amount_cents;

  const withdrawal = await post('/api/leaders/me/withdrawals', { leader_user_id: leader.id, amount_cents: amount });
  assert(withdrawal.status === 'pending', `Withdrawal should be pending, got ${withdrawal.status}`);
  assert(withdrawal.tax_mode === 'pending_review', `Withdrawal tax_mode should be pending_review, got ${withdrawal.tax_mode}`);
  assert(withdrawal.tax_status === 'pending', `Withdrawal tax_status should be pending, got ${withdrawal.tax_status}`);
  assert(withdrawal.payable_amount_cents === amount, 'Withdrawal payable amount should equal gross amount before tax review');
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

  await expectFail(`/api/admin/withdrawals/${secondWithdrawal.id}/mark-paid`, { reason: 'L8 验收未税务复核标记已处理' }, '提现税务状态待复核');
  const noneTaxReview = await post(`/api/admin/withdrawals/${secondWithdrawal.id}/tax-review`, {
    tax_mode: 'none',
    tax_amount_cents: 0,
    tax_rate_basis: 'manual',
    invoice_required: false,
    invoice_status: 'not_required',
    tax_remark: '财务人工确认'
  });
  assert(noneTaxReview.withdrawal.tax_status === 'completed', `Tax status should be completed, got ${noneTaxReview.withdrawal.tax_status}`);
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

  const { leader: withheldLeader, commission: withheldCommission } = await createAvailableCommission('withheld-tax');
  const withheldWithdrawal = await post('/api/leaders/me/withdrawals', { leader_user_id: withheldLeader.id, amount_cents: withheldCommission.final_amount_cents });
  await post(`/api/admin/withdrawals/${withheldWithdrawal.id}/approve`, { reason: 'withheld tax approve' });
  const withheldReview = await post(`/api/admin/withdrawals/${withheldWithdrawal.id}/tax-review`, {
    tax_mode: 'withheld',
    tax_amount_cents: 10,
    tax_rate_basis: 'manual',
    invoice_required: false,
    invoice_status: 'not_required',
    tax_remark: '财务人工确认'
  });
  assert(withheldReview.withdrawal.tax_status === 'calculated', 'withheld tax should be calculated');
  assert(withheldReview.withdrawal.payable_amount_cents === withheldCommission.final_amount_cents - 10, 'withheld payable amount should deduct tax amount');

  const { leader: invoiceLeader, commission: invoiceCommission } = await createAvailableCommission('invoice-tax');
  const invoiceWithdrawal = await post('/api/leaders/me/withdrawals', { leader_user_id: invoiceLeader.id, amount_cents: invoiceCommission.final_amount_cents });
  await post(`/api/admin/withdrawals/${invoiceWithdrawal.id}/approve`, { reason: 'invoice tax approve' });
  const invoiceReview = await post(`/api/admin/withdrawals/${invoiceWithdrawal.id}/tax-review`, {
    tax_mode: 'invoice',
    tax_amount_cents: 0,
    tax_rate_basis: 'manual',
    invoice_required: true,
    invoice_status: 'pending',
    tax_remark: '财务人工确认'
  });
  assert(invoiceReview.withdrawal.invoice_required === true, 'invoice mode should require invoice');
  await expectFail(`/api/admin/withdrawals/${invoiceWithdrawal.id}/mark-paid`, { reason: 'invoice not verified' }, '发票状态未确认');
  const invoiceVerified = await post(`/api/admin/withdrawals/${invoiceWithdrawal.id}/tax-review`, {
    tax_mode: 'invoice',
    tax_amount_cents: 0,
    tax_rate_basis: 'manual',
    invoice_required: true,
    invoice_status: 'verified',
    tax_remark: '财务人工确认'
  });
  assert(invoiceVerified.withdrawal.tax_status === 'completed', 'verified invoice should complete tax status');
  const invoicePaid = await post(`/api/admin/withdrawals/${invoiceWithdrawal.id}/mark-paid`, { reason: 'invoice verified paid' });
  assert(invoicePaid.status === 'paid', 'invoice verified withdrawal should be paid');

  const taxRecords = await json(await app.inject({ method: 'GET', url: `/api/admin/tax-records?source_type=withdrawal&leader_user_id=${withheldLeader.id}` }));
  assert(taxRecords.some((item: { source_id: string }) => item.source_id === withheldWithdrawal.id), 'Tax records API should include withdrawal TaxRecord');
  const conversionTaxRecords = await json(await app.inject({ method: 'GET', url: `/api/admin/tax-records?source_type=reward_conversion&leader_user_id=${convertLeader.id}` }));
  assert(conversionTaxRecords.some((item: { tax_status: string }) => item.tax_status === 'pending_review'), 'Reward conversion TaxRecord should remain pending_review');

  console.log('L1/L2/L3/L4/L5/L6/L7/L8 local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
