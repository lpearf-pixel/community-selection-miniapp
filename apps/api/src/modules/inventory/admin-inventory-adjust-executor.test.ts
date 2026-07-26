import { describe, expect, it } from 'vitest';
import {
  AdminInventoryAdjustCommandError,
  isAdminInventoryAdjustResult,
} from './admin-inventory-adjust-executor.js';

describe('admin inventory adjustment executor contract', () => {
  it('accepts only the stable persisted result shape', () => {
    expect(
      isAdminInventoryAdjustResult({
        product_id: 'product-1',
        stock_before: 20,
        stock_after: 17,
        adjust_quantity: -3,
        stock_unit: '份',
      }),
    ).toBe(true);
    expect(
      isAdminInventoryAdjustResult({
        product_id: 'product-1',
        stock_before: 20,
        stock_after: 17,
        adjust_quantity: -3,
      }),
    ).toBe(false);
    expect(
      isAdminInventoryAdjustResult({
        product_id: 'product-1',
        stock_before: 20.5,
        stock_after: 17,
        adjust_quantity: -3,
        stock_unit: '份',
      }),
    ).toBe(false);
    expect(
      isAdminInventoryAdjustResult({
        product_id: 'product-1',
        stock_before: 20,
        stock_after: 18,
        adjust_quantity: -3,
        stock_unit: '份',
      }),
    ).toBe(false);
  });

  it('exposes typed status and code without leaking another error shape', () => {
    const error = new AdminInventoryAdjustCommandError(
      409,
      'ADMIN_INVENTORY_STOCK_CONFLICT',
      '库存已变化',
    );

    expect(error).toMatchObject({
      name: 'AdminInventoryAdjustCommandError',
      statusCode: 409,
      code: 'ADMIN_INVENTORY_STOCK_CONFLICT',
      message: '库存已变化',
    });
  });
});
