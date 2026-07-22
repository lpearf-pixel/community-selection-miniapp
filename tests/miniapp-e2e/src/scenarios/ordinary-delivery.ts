import {
  DELIVERY_SEQUENCE,
  assertOrderState,
  type OrderRecord,
} from '../fixture-api.js';
import type { ScenarioContext } from '../scenario-context.js';

export interface DeliveryResult {
  openid: string;
  order: OrderRecord;
  receiverAddress: string;
}

export async function runOrdinaryDelivery(
  context: ScenarioContext,
): Promise<DeliveryResult> {
  const openid = `miniapp-business-normal-delivery-${context.runId}`;
  const receiverAddress = '测试路 18 号';
  await context.setUser(openid, '普通购买配送', '13800001002');
  context.reporter.step('ordinary-delivery-product-list-start', {
    productId: context.fixture.product.product_id,
  });

  await context.pages.products.buy(context.fixture.product);
  const detailPage = await context.pages.checkout.submitDelivery({
    name: '配送测试用户',
    phone: '13800001002',
    address: receiverAddress,
  });
  const paid = await context.pages.orderDetail.waitForOrder(
    detailPage,
    (order) => order.pay_status === 'paid' && order.pickup_type === 'delivery',
  );
  assertOrderState(paid, { pay_status: 'paid', pickup_type: 'delivery' });
  context.trackOrder(paid, openid);

  const completed = await context.api.advanceOrder(
    paid.id,
    DELIVERY_SEQUENCE,
    openid,
    (event, details) => context.reporter.step(event, details),
  );
  assertOrderState(completed, { order_status: 'completed' });
  const page = await context.pages.orderDetail.open(paid.id);
  await context.pages.orderDetail.waitForOrder(
    page,
    (order) => order.order_status === 'completed',
  );
  context.reporter.step('ordinary-delivery-passed', { orderId: completed.id });
  return { openid, order: completed, receiverAddress };
}
