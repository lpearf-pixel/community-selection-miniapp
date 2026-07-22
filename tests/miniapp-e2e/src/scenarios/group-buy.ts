import {
  STORE_SEQUENCE,
  assertGroupSucceeded,
  assertOrderState,
  type OrderRecord,
} from '../fixture-api.js';
import type { ScenarioContext } from '../scenario-context.js';

interface Participant {
  openid: string;
  name: string;
  phone: string;
}

interface ParticipantOrder extends OrderRecord {
  participantOpenid: string;
  group_buy_id?: string;
}

async function createParticipantOrder(
  context: ScenarioContext,
  groupBuyId: string,
  participant: Participant,
  usedOrderIds: Set<string>,
): Promise<ParticipantOrder> {
  await context.setUser(participant.openid, participant.name, participant.phone);
  const groupPage = await context.pages.groupDetail.open(groupBuyId);
  await context.pages.groupDetail.waitForGroup(
    groupPage,
    (group) => group.can_join === true,
  );
  await context.pages.groupDetail.join(groupPage);
  const ordersPage = await context.pages.groupOrder.submit(participant.name, participant.phone);
  const orders = await context.driver.waitForData<OrderRecord[]>(
    ordersPage,
    'orders',
    (items) => Array.isArray(items) && items.some((order) => (
      order.group_buy_id === groupBuyId
      && order.pay_status === 'paid'
      && !usedOrderIds.has(order.id)
    )),
    { description: `${participant.name} paid group order` },
  );
  const order = orders.find((item) => (
    item.group_buy_id === groupBuyId
    && item.pay_status === 'paid'
    && !usedOrderIds.has(item.id)
  ));
  if (!order) throw new Error(`Paid group order not found for ${participant.openid}`);
  usedOrderIds.add(order.id);
  context.trackOrder(order, participant.openid);
  context.reporter.step('group-participant-paid', {
    groupBuyId,
    orderId: order.id,
    openid: participant.openid,
  });
  return { ...order, participantOpenid: participant.openid };
}

export async function runGroupBuy(context: ScenarioContext) {
  await context.setUser(
    'leader-openid',
    '测试开团人',
    '13800000001',
    { trackOrders: false },
  );
  const detailPage = await context.pages.startGroup.create(
    context.fixture.product,
    context.fixture.community,
  );
  const created = await context.pages.groupDetail.waitForGroup(
    detailPage,
    (group) => Boolean(group.group_buy_id ?? group.id),
  );
  const groupBuyId = String(created.group_buy_id ?? created.id);
  context.reporter.step('group-created', { groupBuyId });

  const participants: Participant[] = [
    {
      openid: `miniapp-business-group-a-${context.runId}`,
      name: '参团用户A',
      phone: '13800002001',
    },
    {
      openid: `miniapp-business-group-b-${context.runId}`,
      name: '参团用户B',
      phone: '13800002002',
    },
  ];
  const usedOrderIds = new Set<string>();
  const orders: ParticipantOrder[] = [];
  for (const participant of participants) {
    orders.push(await createParticipantOrder(context, groupBuyId, participant, usedOrderIds));
  }

  const succeeded = await context.waitForGroup(
    groupBuyId,
    (group) => group.status === 'success'
      && Number(group.paid_quantity ?? group.current_quantity ?? 0) >= 2,
  );
  assertGroupSucceeded(succeeded);
  for (const order of orders) {
    const completed = await context.api.advanceOrder(
      order.id,
      STORE_SEQUENCE,
      order.participantOpenid,
      (event, details) => context.reporter.step(event, details),
    );
    assertOrderState(completed, { order_status: 'completed' });
  }
  assertGroupSucceeded(await context.api.getGroupBuy(groupBuyId));
  context.reporter.step('group-buy-passed', {
    groupBuyId,
    paid_quantity: succeeded.paid_quantity,
    orderIds: orders.map((order) => order.id),
  });
  return { groupBuyId, orders };
}
