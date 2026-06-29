import { PrismaClient } from '@prisma/client';
import { buildApp } from '../apps/api/src/app.js';
import { releaseAvailableCommissions } from '../apps/api/src/services/commission-service.js';

const prisma = new PrismaClient();
const app = buildApp();
const stamp = Date.now();
const prefix = `logs-${stamp}`;
const phone = '13800005001';

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

async function main() {
  const category = await prisma.category.create({ data: { name: `${prefix}-category`, sort_order: 1300, status: 'active' } });
  const community = await prisma.community.create({ data: { name: `${prefix}-community`, address: 'L7.5 日志验收社区', status: 'active' } });
  const leader = await prisma.user.create({ data: { openid: `${prefix}-leader`, nickname: 'L7.5 验收开团人', role: 'leader', status: 'active' } });
  const user = await prisma.user.create({ data: { openid: `${prefix}-user`, nickname: 'L7.5 用户', role: 'customer', status: 'active' } });
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
    receiver_name: '日志用户',
    receiver_phone: phone,
    receiver_address: '上海市浦东新区日志验收详细地址 100 号'
  });

  let timeline = await prisma.orderTimelineLog.findMany({ where: { order_id: order.id } });
  assert(timeline.some((item) => item.event_type === 'order_created'), 'order_created timeline should exist');

  await post('/api/payments/mock', { order_id: order.id });
  assert(await prisma.businessEventLog.count({ where: { order_id: order.id, event_type: 'payment_mark_order_paid' } }) === 1, 'payment_mark_order_paid event should exist');
  assert(await prisma.businessEventLog.count({ where: { order_id: order.id, event_type: 'commission_estimated' } }) === 1, 'commission_estimated event should exist');

  await post(`/api/orders/${order.id}/status`, { next_status: 'completed' });
  assert(await prisma.businessEventLog.count({ where: { order_id: order.id, event_type: 'commission_pending' } }) === 1, 'commission_pending event should exist');
  const commission = await prisma.commission.findFirstOrThrow({ where: { order_id: order.id } });
  await prisma.commission.update({ where: { id: commission.id }, data: { available_at: new Date(Date.now() - 1000) } });
  await releaseAvailableCommissions();
  assert(await prisma.businessEventLog.count({ where: { order_id: order.id, event_type: 'commission_available' } }) === 1, 'commission_available event should exist');

  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 500,
    reason: 'L7.5 日志验收可用后退款',
    client_refund_id: `${prefix}-available-refund`
  });
  const warningEvent = await prisma.businessEventLog.findFirstOrThrow({ where: { order_id: order.id, event_type: 'commission_adjusted_after_refund' }, orderBy: { created_at: 'desc' } });
  assert(warningEvent.event_level === 'warning', 'available refund should create warning business event');
  assert(warningEvent.before_snapshot !== null && warningEvent.after_snapshot !== null, 'commission refund event should include before and after snapshots');

  await prisma.commission.update({ where: { id: commission.id }, data: { status: 'withdrawn' } });
  await post('/api/refunds/mock', {
    order_id: order.id,
    refund_amount_cents: 500,
    reason: 'L7.5 日志验收提现后退款告警',
    client_refund_id: `${prefix}-withdrawn-refund`
  });
  const alert = await prisma.opsAlertLog.findFirstOrThrow({ where: { order_id: order.id, alert_type: 'refund_after_withdrawn' } });
  assert(alert.status === 'open', 'refund after withdrawn should raise open alert');

  timeline = await json(await app.inject({ method: 'GET', url: `/api/admin/logs/order-timeline?order_id=${order.id}` }));
  assert(timeline.some((item: { event_type: string }) => item.event_type === 'commission_available'), 'timeline API should return commission_available');
  const events = await json(await app.inject({ method: 'GET', url: `/api/admin/logs/business-events?order_id=${order.id}` }));
  assert(events.some((item: { event_type: string }) => item.event_type === 'commission_adjusted_after_refund'), 'business events API should return refund adjustment');
  const alerts = await json(await app.inject({ method: 'GET', url: '/api/admin/logs/alerts' }));
  assert(alerts.some((item: { id: string }) => item.id === alert.id), 'alerts API should return alert');
  const resolved = await post(`/api/admin/logs/alerts/${alert.id}/resolve`, { resolved_by: 'admin', resolution_note: '日志验收处理' });
  assert(resolved.status === 'resolved', 'resolved alert should become resolved');
  const aiContext = await json(await app.inject({ method: 'GET', url: `/api/admin/logs/orders/${order.id}/ai-context` }));
  assert(aiContext.order.id === order.id && Array.isArray(aiContext.suggested_focus), 'AI context should return structured order context');

  const logsText = JSON.stringify(await prisma.businessEventLog.findMany({ where: { order_id: order.id } }));
  assert(!logsText.includes(phone), 'business event logs should not contain full phone');
  assert(!/token|private_key|password|certificate|api_v3_key|secret/i.test(logsText), 'business event logs should not contain sensitive key names');

  console.log('L1/L2/L3/L4/L5/L6/L7 logs local verification passed.');
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
