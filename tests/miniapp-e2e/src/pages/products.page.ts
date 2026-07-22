import { MiniappPageObject, type MiniProgramPage } from '@community-selection/miniapp-testkit';
import type { ProductFixture } from '../fixture-api.js';

export class ProductsPage extends MiniappPageObject {
  readonly route = 'pages/products/index';

  async buy(product: ProductFixture): Promise<MiniProgramPage> {
    await this.driver.session.reLaunch(
      `/${this.route}?keyword=${encodeURIComponent(product.name)}`,
    );
    const page = await this.current();
    await this.tap(page, {
      description: `direct buy for ${product.product_id}`,
      renderSelector: '.e2e-product-normal-buy',
      querySelector: `#product-normal-buy-${product.product_id}`,
      dataset: { id: product.product_id },
    });
    return this.driver.waitForRoute('pages/orders/confirm/index');
  }
}
