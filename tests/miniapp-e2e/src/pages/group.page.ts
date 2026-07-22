import { MiniappPageObject, type MiniProgramPage } from '@community-selection/miniapp-testkit';
import type { CommunityFixture, ProductFixture } from '../fixture-api.js';

const target = (testId: string, description: string) => ({
  description,
  renderSelector: `.e2e-${testId}`,
});

export class StartGroupBuyPage extends MiniappPageObject {
  readonly route = 'pages/start-group-buy/index';
  readonly productPicker = target('group-product-picker', 'group product picker');
  readonly communityPicker = target('group-community-picker', 'group community picker');

  async create(product: ProductFixture, community: CommunityFixture): Promise<MiniProgramPage> {
    await this.driver.session.reLaunch(`/${this.route}`);
    const page = await this.current();
    const products = await this.driver.waitForData<Array<Record<string, unknown>>>(
      page,
      'products',
      (value) => Array.isArray(value) && value.length > 0,
      { description: 'group products' },
    );
    const communities = await this.driver.waitForData<Array<Record<string, unknown>>>(
      page,
      'communities',
      (value) => Array.isArray(value) && value.length > 0,
      { description: 'group communities' },
    );
    const productIndex = products.findIndex((item) => (
      String(item.product_id ?? item.id) === product.product_id
    ));
    const communityIndex = communities.findIndex((item) => (
      String(item.community_id ?? item.id) === community.community_id
    ));
    if (productIndex < 0) throw new Error(`Group product ${product.product_id} is not selectable`);
    if (communityIndex < 0) throw new Error(`Group community ${community.community_id} is not selectable`);
    await this.driver.invoke(
      page,
      this.productPicker,
      'onProductChange',
      { detail: { value: String(productIndex) } },
    );
    await this.driver.invoke(
      page,
      this.communityPicker,
      'onCommunityChange',
      { detail: { value: String(communityIndex) } },
    );
    await this.driver.invoke(
      page,
      target('group-min-people', 'group minimum people'),
      'onMinPeopleInput',
      { detail: { value: '2' } },
    );
    await this.driver.invoke(
      page,
      target('group-min-quantity', 'group minimum quantity'),
      'onMinQuantityInput',
      { detail: { value: '2' } },
    );
    await this.driver.invoke(page, target('group-create-submit', 'group create submit'), 'submit');
    return this.driver.waitForRoute('pages/group-buy-detail/index');
  }
}

export class GroupBuyDetailPage extends MiniappPageObject {
  readonly route = 'pages/group-buy-detail/index';

  async open(groupBuyId: string): Promise<MiniProgramPage> {
    await this.driver.session.reLaunch(`/${this.route}?id=${encodeURIComponent(groupBuyId)}`);
    return this.current();
  }

  async waitForGroup(
    page: MiniProgramPage,
    predicate: (group: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    return this.driver.waitForData(page, 'groupBuy', predicate, {
      description: 'visible group detail',
    });
  }

  async join(page?: MiniProgramPage): Promise<MiniProgramPage> {
    const currentPage = page ?? await this.current();
    await this.driver.invoke(currentPage, target('group-join', 'group join'), 'join');
    return this.driver.waitForRoute('pages/join-order/index');
  }
}

export class GroupOrderPage extends MiniappPageObject {
  readonly route = 'pages/join-order/index';

  async submit(name: string, phone: string): Promise<MiniProgramPage> {
    const page = await this.current();
    await this.driver.invoke(
      page,
      target('group-order-name', 'group order name'),
      'onNameInput',
      { detail: { value: name } },
    );
    await this.driver.invoke(
      page,
      target('group-order-phone', 'group order phone'),
      'onPhoneInput',
      { detail: { value: phone } },
    );
    await this.driver.invoke(
      page,
      target('group-order-quantity', 'group order quantity'),
      'onQuantityInput',
      { detail: { value: '1' } },
    );
    await this.driver.invoke(page, target('group-order-submit', 'group order submit'), 'submit');
    return this.driver.waitForRoute('pages/orders/index');
  }
}
