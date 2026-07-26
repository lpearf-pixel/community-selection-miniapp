import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '../../../shared/api/errors';
import { commitInventoryAdjustment } from './inventory-adjust-mutation';

const item = {
  product_id: 'product-1',
  stock: 20,
};

describe('inventory adjustment mutation', () => {
  it('shows success and refreshes after a committed command', async () => {
    const adjust = vi.fn().mockResolvedValue({
      product_id: 'product-1',
      stock_before: 20,
      stock_after: 17,
      adjust_quantity: -3,
      stock_unit: '份',
    });
    const onMessage = vi.fn();
    const onMutationCommitted = vi.fn();

    await expect(
      commitInventoryAdjustment({
        item,
        adjust_quantity: -3,
        reason: '盘亏',
        adjust,
        onMessage,
        onMutationCommitted,
      }),
    ).resolves.toBe('success');

    expect(adjust).toHaveBeenCalledWith('product-1', 20, -3, '盘亏');
    expect(onMessage).toHaveBeenCalledWith('库存调整已保存');
    expect(onMutationCommitted).toHaveBeenCalledOnce();
  });

  it('refreshes a stock conflict without displaying false success', async () => {
    const adjust = vi.fn().mockRejectedValue(
      new AdminApiError(
        '库存已变化，请刷新后重试',
        409,
        'ADMIN_INVENTORY_STOCK_CONFLICT',
      ),
    );
    const onMessage = vi.fn();
    const onMutationCommitted = vi.fn();

    await expect(
      commitInventoryAdjustment({
        item,
        adjust_quantity: -3,
        reason: '盘亏',
        adjust,
        onMessage,
        onMutationCommitted,
      }),
    ).resolves.toBe('conflict');

    expect(onMessage).toHaveBeenCalledWith(
      '库存已变化，已刷新，请基于最新库存重试',
    );
    expect(onMessage).not.toHaveBeenCalledWith('库存调整已保存');
    expect(onMutationCommitted).toHaveBeenCalledOnce();
  });

  it('keeps non-conflict failures in the global error path', async () => {
    const error = new AdminApiError(
      '网络请求失败',
      0,
      'NETWORK_ERROR',
    );

    await expect(
      commitInventoryAdjustment({
        item,
        adjust_quantity: -3,
        reason: '盘亏',
        adjust: vi.fn().mockRejectedValue(error),
        onMessage: vi.fn(),
        onMutationCommitted: vi.fn(),
      }),
    ).rejects.toBe(error);
  });
});
