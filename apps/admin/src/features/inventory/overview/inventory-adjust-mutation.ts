import { AdminApiError } from '../../../shared/api/errors';
import {
  adjustInventory,
  type InventoryAdjustmentResult,
} from './api';

type AdjustmentTarget = {
  product_id: string;
  stock: number;
};

type Adjust = (
  productId: string,
  expectedStock: number,
  adjustQuantity: number,
  reason: string,
) => Promise<InventoryAdjustmentResult>;

export async function commitInventoryAdjustment(input: {
  item: AdjustmentTarget;
  adjust_quantity: number;
  reason: string;
  adjust?: Adjust;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
}): Promise<'success' | 'conflict'> {
  const adjust = input.adjust ?? adjustInventory;
  try {
    await adjust(
      input.item.product_id,
      input.item.stock,
      input.adjust_quantity,
      input.reason,
    );
    input.onMessage('库存调整已保存');
    input.onMutationCommitted();
    return 'success';
  } catch (error) {
    if (
      error instanceof AdminApiError &&
      error.status === 409 &&
      error.code === 'ADMIN_INVENTORY_STOCK_CONFLICT'
    ) {
      input.onMessage('库存已变化，已刷新，请基于最新库存重试');
      input.onMutationCommitted();
      return 'conflict';
    }
    throw error;
  }
}
