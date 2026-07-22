import { MiniappPageObject, type MiniProgramPage } from '@community-selection/miniapp-testkit';

const target = (testId: string, description: string) => ({
  description,
  renderSelector: `.e2e-${testId}`,
});

export interface DeliveryForm {
  name: string;
  phone: string;
  address: string;
}

export class CheckoutPage extends MiniappPageObject {
  readonly route = 'pages/orders/confirm/index';

  async ready(): Promise<MiniProgramPage> {
    const page = await this.current();
    await this.driver.waitForData(page, 'product', Boolean, {
      description: 'checkout product',
    });
    await this.driver.waitForData(page, 'pickup_store_id', Boolean, {
      description: 'checkout pickup store',
    });
    return page;
  }

  async submitStore(): Promise<MiniProgramPage> {
    const page = await this.ready();
    await this.tap(page, target('fulfillment-store', 'store fulfillment'));
    await this.tap(page, target('checkout-submit', 'checkout submit'));
    return this.driver.waitForRoute('pages/orders/detail/index');
  }

  async submitDelivery(form: DeliveryForm): Promise<MiniProgramPage> {
    const page = await this.ready();
    await this.tap(page, target('fulfillment-delivery', 'delivery fulfillment'));
    await this.driver.waitForData<unknown[]>(page, 'delivery_time_windows', (value) => (
      Array.isArray(value) && value.length > 0
    ), { description: 'delivery time windows' });
    await this.tap(page, target('delivery-window', 'first delivery window'));
    await this.input(page, target('receiver-name', 'receiver name'), form.name);
    await this.input(page, target('receiver-phone', 'receiver phone'), form.phone);
    await this.input(page, target('receiver-address', 'receiver address'), form.address);
    await this.tap(page, target('checkout-submit', 'checkout submit'));
    return this.driver.waitForRoute('pages/orders/detail/index');
  }
}
