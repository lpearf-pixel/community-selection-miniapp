import type { MiniProgramPage } from '@community-selection/miniapp-testkit';
import {
  STORE_SEQUENCE,
  assertOrderState,
  type OrderRecord,
} from '../fixture-api.js';
import type { ScenarioContext } from '../scenario-context.js';

export interface PickupRefundResult {
  openid: string;
  order: OrderRecord;
}

export async function runOrdinaryPickupRefund(
  context: ScenarioContext,
): Promise<PickupRefundResult> {
  const openid = `miniapp-business-normal-store-${context.runId}`;
  await context.setUser(openid, '普通购买自提', '13800001001');
  context.reporter.step('ordinary-store-product-list-start', {
    productId: context.fixture.product.product_id,
  });

  await context.pages.products.buy(context.fixture.product);
  const detailPage = await context.pages.checkout.submitStore();
  const paid = await context.pages.orderDetail.waitForOrder(
    detailPage,
    (order) => order.pay_status === 'paid' && order.pickup_type === 'store',
  );
  assertOrderState(paid, { pay_status: 'paid', pickup_type: 'store' });
  context.trackOrder(paid, openid);

  const completed = await context.api.advanceOrder(
    paid.id,
    STORE_SEQUENCE,
    openid,
    (event, details) => context.reporter.step(event, details),
  );
  assertOrderState(completed, { order_status: 'completed' });

  let page: MiniProgramPage = await context.pages.orderDetail.open(paid.id);
  await context.pages.orderDetail.waitForOrder(
    page,
    (order) => order.order_status === 'completed' && order.can_apply_after_sale === true,
  );
  page = await context.pages.orderDetail.applyAfterSale(page);
  page = await context.pages.afterSales.submit('点击闭环测试售后');
  await context.driver.waitForData<unknown[]>(
    page,
    'items',
    (items) => Array.isArray(items) && items.length > 0,
    { description: 'submitted after-sale case' },
  );

  const refundable = await context.api.getUserOrder(paid.id, openid);
  await context.api.createFullMockRefund(refundable, context.runId);
  const refunded = await context.api.getUserOrder(paid.id, openid);
  assertOrderState(refunded, {
    pay_status: 'paid',
    order_status: 'refunded',
    refund_status: 'success',
  });
  context.reporter.step('ordinary-pickup-refund-passed', { orderId: refunded.id });
  return { openid, order: refunded };
}
