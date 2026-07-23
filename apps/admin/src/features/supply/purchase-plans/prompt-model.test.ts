import { describe, expect, it, vi } from 'vitest';
import type { InventoryProductReference } from '../../inventory/shared/types';
import { collectPurchasePlanInput } from './prompt-model';

const productReference: InventoryProductReference = {
  product_id: 'p1',
  product_name: '有机番茄',
  stock_unit: '斤',
  suggest_purchase_quantity: 20,
  stock_deduct_quantity: 2,
};

describe('purchase-plan prompt model', () => {
  it('builds the unchanged payload from the default product', () => {
    const answers = ['3', '箱', '24', '1200'];
    const prompt = vi.fn(() => answers.shift() ?? null);

    const input = collectPurchasePlanInput(productReference, prompt, () => 0);

    expect(input).toEqual({
      target_date: new Date(24 * 60 * 60 * 1000).toISOString(),
      supplier_name: '默认供应商',
      remark: '后台创建采购计划：采购数量与入库库存数量分开记录',
      items: [
        {
          product_id: 'p1',
          purchase_quantity: 3,
          purchase_unit: '箱',
          stock_in_quantity: 24,
          cost_price_cents: 1200,
          remark: '采购 3箱，入库 24斤',
        },
      ],
    });
    expect(prompt).toHaveBeenNthCalledWith(
      3,
      '请输入折算后的入库库存数量（基础库存单位：斤）',
      '20',
    );
  });

  it.each([
    [[''], 'purchase quantity'],
    [['1', ''], 'purchase unit'],
    [['1', '箱', ''], 'stock-in quantity'],
    [['1', '箱', '2', null], 'cost price'],
  ] as const)('cancels without a payload at %s', (answers, _label) => {
    const remaining = [...answers];
    const prompt = vi.fn(() => remaining.shift() ?? null);

    expect(
      collectPurchasePlanInput(productReference, prompt, () => 0),
    ).toBeNull();
  });

  it('keeps an empty cost price as zero like the legacy prompt flow', () => {
    const answers = ['1', '箱', '2', ''];
    const prompt = vi.fn(() => answers.shift() ?? null);

    expect(
      collectPurchasePlanInput(productReference, prompt, () => 0)?.items[0]
        .cost_price_cents,
    ).toBe(0);
  });
});
