import { MiniappPageObject, type MiniProgramPage } from '@community-selection/miniapp-testkit';

export interface VisibleOrder {
  id: string;
  pay_status?: string;
  order_status?: string;
  refund_status?: string;
  pickup_type?: string;
  can_apply_after_sale?: boolean;
  [key: string]: unknown;
}

export class OrderDetailPage extends MiniappPageObject {
  readonly route = 'pages/orders/detail/index';

  async open(orderId: string): Promise<MiniProgramPage> {
    await this.driver.session.reLaunch(`/${this.route}?id=${encodeURIComponent(orderId)}`);
    return this.current();
  }

  async waitForOrder(page: MiniProgramPage, predicate: (order: VisibleOrder) => boolean): Promise<VisibleOrder> {
    return this.driver.waitForData<VisibleOrder>(page, 'order', predicate, {
      description: 'visible order detail',
    });
  }

  async applyAfterSale(page: MiniProgramPage): Promise<MiniProgramPage> {
    await this.driver.invoke(page, {
      description: 'after-sale apply',
      renderSelector: '.e2e-after-sale-apply',
    }, 'applyAfterSale');
    return this.driver.waitForRoute('pages/after-sales/apply/index');
  }
}
