import { MiniappPageObject, type MiniProgramPage } from '@community-selection/miniapp-testkit';
import type { CommunityFixture, ProductFixture } from '../fixture-api.js';

const target = (testId: string, description: string) => ({
  description,
  renderSelector: `[data-testid="${testId}"]`,
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
    await this.driver.trigger(page, this.productPicker, 'change', { value: String(productIndex) });
    await this.driver.trigger(page, this.communityPicker, 'change', { value: String(communityIndex) });
    await this.input(page, target('group-min-people', 'group minimum people'), '2');
    await this.input(page, target('group-min-quantity', 'group minimum quantity'), '2');
    await this.tap(page, target('group-create-submit', 'group create submit'));
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
    await this.tap(currentPage, target('group-join', 'group join'));
    return this.driver.waitForRoute('pages/join-order/index');
  }
}

export class GroupOrderPage extends MiniappPageObject {
  readonly route = 'pages/join-order/index';

  async submit(name: string, phone: string): Promise<MiniProgramPage> {
    const page = await this.current();
    await this.input(page, target('group-order-name', 'group order name'), name);
    await this.input(page, target('group-order-phone', 'group order phone'), phone);
    await this.input(page, target('group-order-quantity', 'group order quantity'), '1');
    await this.tap(page, target('group-order-submit', 'group order submit'));
    return this.driver.waitForRoute('pages/orders/index');
  }
}
