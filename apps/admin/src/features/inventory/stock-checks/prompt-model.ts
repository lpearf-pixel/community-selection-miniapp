import type { CreateStockCheckInput } from '../shared/types';

export type PromptFunction = (
  message: string,
  defaultValue?: string,
) => string | null;

export function collectStockCheckInput(
  defaults: {
    defaultBatchId: string;
    defaultProductId: string;
  },
  prompt: PromptFunction,
): CreateStockCheckInput | null {
  const batchId =
    prompt(
      '请输入批次 ID（留空则按商品总库存盘点）',
      defaults.defaultBatchId,
    ) ?? '';
  const productId = batchId
    ? undefined
    : (prompt('请输入商品 ID', defaults.defaultProductId) ?? '');
  if (!batchId && !productId) return null;

  const actualText = prompt('请输入实际库存数量（基础库存单位）', '0');
  if (actualText === null) return null;
  const reason = prompt('请输入盘点原因', '后台盘点') ?? '';

  return {
    remark: '后台创建盘点',
    items: [
      {
        batch_id: batchId || undefined,
        product_id: productId || undefined,
        actual_quantity: Number(actualText),
        reason,
      },
    ],
  };
}
