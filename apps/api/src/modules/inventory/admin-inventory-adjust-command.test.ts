import { describe, expect, it } from 'vitest';
import {
  buildAdminInventoryAdjustRequestHash,
  parseAdminInventoryAdjustCommand,
} from './admin-inventory-adjust-command.js';

const valid = {
  expected_stock: 20,
  adjust_quantity: -3,
  reason: '门店盘点差异',
  idempotency_key: 'inventory-adjust-0001',
};

describe('admin inventory adjustment command', () => {
  it('normalizes the reason and accepts the exact command shape', () => {
    expect(
      parseAdminInventoryAdjustCommand({
        ...valid,
        reason: '  门店盘点差异  ',
      }),
    ).toEqual({
      ok: true,
      value: valid,
    });
  });

  it.each([
    null,
    [],
    {},
    { ...valid, extra: true },
    { ...valid, expected_stock: -1 },
    { ...valid, expected_stock: 1.5 },
    { ...valid, expected_stock: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, adjust_quantity: 0 },
    { ...valid, adjust_quantity: 1.5 },
    { ...valid, adjust_quantity: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, expected_stock: 2, adjust_quantity: -3 },
    {
      ...valid,
      expected_stock: Number.MAX_SAFE_INTEGER,
      adjust_quantity: 1,
    },
    { ...valid, reason: '   ' },
    { ...valid, reason: 'a'.repeat(201) },
    { ...valid, reason: 'invalid\nreason' },
    { ...valid, idempotency_key: 'too-short' },
    { ...valid, idempotency_key: ` ${valid.idempotency_key}` },
    { ...valid, idempotency_key: 'a'.repeat(129) },
    { ...valid, idempotency_key: 'inventory-adjust-\u007f' },
  ])('rejects invalid input %#', (input) => {
    expect(parseAdminInventoryAdjustCommand(input)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_INVENTORY_ADJUST_COMMAND',
      message: '库存调整命令不合法',
    });
  });

  it('builds a stable digest and changes it for every business field', () => {
    const input = {
      product_id: 'product-1',
      expected_stock: 20,
      adjust_quantity: -3,
      reason: '门店盘点差异',
    };
    const digest = buildAdminInventoryAdjustRequestHash(input);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(buildAdminInventoryAdjustRequestHash(input)).toBe(digest);
    expect(
      buildAdminInventoryAdjustRequestHash({
        ...input,
        product_id: 'product-2',
      }),
    ).not.toBe(digest);
    expect(
      buildAdminInventoryAdjustRequestHash({
        ...input,
        expected_stock: 21,
      }),
    ).not.toBe(digest);
    expect(
      buildAdminInventoryAdjustRequestHash({
        ...input,
        adjust_quantity: -2,
      }),
    ).not.toBe(digest);
    expect(
      buildAdminInventoryAdjustRequestHash({
        ...input,
        reason: '其他原因',
      }),
    ).not.toBe(digest);
  });
});
