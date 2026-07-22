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

const datasetEvent = (dataset: Record<string, string>) => ({ currentTarget: { dataset } });
const inputEvent = (field: string, value: string) => ({
  currentTarget: { dataset: { field } },
  detail: { value },
});

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
    await this.driver.invoke(
      page,
      target('fulfillment-store', 'store fulfillment'),
      'selectPickupType',
      datasetEvent({ type: 'store' }),
    );
    await this.driver.invoke(page, target('checkout-submit', 'checkout submit'), 'submit');
    return this.driver.waitForRoute('pages/orders/detail/index');
  }

  async submitDelivery(form: DeliveryForm): Promise<MiniProgramPage> {
    const page = await this.ready();
    await this.driver.invoke(
      page,
      target('fulfillment-delivery', 'delivery fulfillment'),
      'selectPickupType',
      datasetEvent({ type: 'delivery' }),
    );
    const windows = await this.driver.waitForData<Array<{ code?: unknown }>>(
      page,
      'delivery_time_windows',
      (value) => (
      Array.isArray(value) && value.length > 0
      ),
      { description: 'delivery time windows' },
    );
    const firstWindowCode = String(windows[0]?.code ?? '');
    if (!firstWindowCode) throw new Error('First delivery time window has no code');
    await this.driver.invoke(
      page,
      target('delivery-window', 'first delivery window'),
      'selectDeliveryTimeWindow',
      datasetEvent({ code: firstWindowCode }),
    );
    await this.driver.invoke(
      page,
      target('receiver-name', 'receiver name'),
      'onInput',
      inputEvent('receiver_name', form.name),
    );
    await this.driver.invoke(
      page,
      target('receiver-phone', 'receiver phone'),
      'onInput',
      inputEvent('receiver_phone', form.phone),
    );
    await this.driver.invoke(
      page,
      target('receiver-address', 'receiver address'),
      'onInput',
      inputEvent('receiver_address', form.address),
    );
    await this.driver.invoke(page, target('checkout-submit', 'checkout submit'), 'submit');
    return this.driver.waitForRoute('pages/orders/detail/index');
  }
}
