import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Community Selection page objects', () => {
  it('owns one route per page and uses only stable project selectors', () => {
    const contracts: Record<string, string[]> = {
      'tests/miniapp-e2e/src/pages/products.page.ts': [
        "route = 'pages/products/index'",
        'product-normal-buy',
        'product-normal-buy-${product.product_id}',
        'encodeURIComponent(product.name)',
      ],
      'tests/miniapp-e2e/src/pages/checkout.page.ts': [
        "route = 'pages/orders/confirm/index'",
        'fulfillment-store',
        'fulfillment-delivery',
        'delivery-window',
        'receiver-name',
        'receiver-phone',
        'receiver-address',
        'checkout-submit',
      ],
      'tests/miniapp-e2e/src/pages/order-detail.page.ts': [
        "route = 'pages/orders/detail/index'",
        'after-sale-apply',
      ],
      'tests/miniapp-e2e/src/pages/after-sales.page.ts': [
        "route = 'pages/after-sales/apply/index'",
        'after-sale-reason',
        'after-sale-submit',
      ],
      'tests/miniapp-e2e/src/pages/group.page.ts': [
        "route = 'pages/start-group-buy/index'",
        'group-product-picker',
        'group-community-picker',
        'group-min-people',
        'group-min-quantity',
        'group-create-submit',
        "route = 'pages/group-buy-detail/index'",
        'group-join',
        "route = 'pages/join-order/index'",
        'group-order-name',
        'group-order-phone',
        'group-order-quantity',
        'group-order-submit',
        'driver.trigger',
      ],
    };

    for (const [relativePath, markers] of Object.entries(contracts)) {
      const source = read(relativePath);
      for (const marker of markers) expect(source, `${relativePath} missing ${marker}`).toContain(marker);
      expect(source).not.toContain('.callMethod(');
    }
  });

  it('backs every page-object action with a real WXML test hook', () => {
    const hooks: Record<string, string[]> = {
      'apps/miniapp/pages/products/index.wxml': [
        'id="product-normal-buy-{{item.product_id}}"',
        'data-testid="product-normal-buy"',
      ],
      'apps/miniapp/pages/orders/confirm/index.wxml': [
        'data-testid="fulfillment-store"',
        'data-testid="fulfillment-delivery"',
        'data-testid="delivery-window"',
        'data-testid="receiver-name"',
        'data-testid="receiver-phone"',
        'data-testid="receiver-address"',
        'data-testid="checkout-submit"',
      ],
      'apps/miniapp/pages/orders/detail/index.wxml': ['data-testid="after-sale-apply"'],
      'apps/miniapp/pages/after-sales/apply/index.wxml': [
        'data-testid="after-sale-reason"',
        'data-testid="after-sale-submit"',
      ],
      'apps/miniapp/pages/start-group-buy/index.wxml': [
        'data-testid="group-product-picker"',
        'data-testid="group-community-picker"',
        'data-testid="group-min-people"',
        'data-testid="group-min-quantity"',
        'data-testid="group-create-submit"',
      ],
      'apps/miniapp/pages/group-buy-detail/index.wxml': ['data-testid="group-join"'],
      'apps/miniapp/pages/join-order/index.wxml': [
        'data-testid="group-order-name"',
        'data-testid="group-order-phone"',
        'data-testid="group-order-quantity"',
        'data-testid="group-order-submit"',
      ],
    };

    for (const [relativePath, markers] of Object.entries(hooks)) {
      const source = read(relativePath);
      for (const marker of markers) expect(source, `${relativePath} missing ${marker}`).toContain(marker);
    }
  });
});
