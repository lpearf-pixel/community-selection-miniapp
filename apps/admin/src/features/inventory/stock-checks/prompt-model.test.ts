import { describe, expect, it, vi } from 'vitest';
import { collectStockCheckInput } from './prompt-model';

describe('stock-check prompt model', () => {
  it('uses the first batch when one is available', () => {
    const answers = ['b1', '8', '后台盘点'];
    const prompt = vi.fn(() => answers.shift() ?? null);

    expect(
      collectStockCheckInput(
        { defaultBatchId: 'b1', defaultProductId: 'p1' },
        prompt,
      ),
    ).toEqual({
      remark: '后台创建盘点',
      items: [
        {
          batch_id: 'b1',
          product_id: undefined,
          actual_quantity: 8,
          reason: '后台盘点',
        },
      ],
    });
    expect(prompt).not.toHaveBeenCalledWith('请输入商品 ID', 'p1');
  });

  it('falls back to the first product when the batch is left empty', () => {
    const answers = ['', 'p1', '6', '月末盘点'];
    const prompt = vi.fn(() => answers.shift() ?? null);

    expect(
      collectStockCheckInput(
        { defaultBatchId: 'b1', defaultProductId: 'p1' },
        prompt,
      ),
    ).toEqual({
      remark: '后台创建盘点',
      items: [
        {
          batch_id: undefined,
          product_id: 'p1',
          actual_quantity: 6,
          reason: '月末盘点',
        },
      ],
    });
  });

  it('does not submit when neither batch nor product is selected', () => {
    const answers = ['', ''];
    const prompt = vi.fn(() => answers.shift() ?? null);

    expect(
      collectStockCheckInput(
        { defaultBatchId: '', defaultProductId: '' },
        prompt,
      ),
    ).toBeNull();
  });

  it('does not submit when actual quantity is cancelled', () => {
    const answers = ['b1', null];
    const prompt = vi.fn(() => answers.shift() ?? null);

    expect(
      collectStockCheckInput(
        { defaultBatchId: 'b1', defaultProductId: 'p1' },
        prompt,
      ),
    ).toBeNull();
  });
});
