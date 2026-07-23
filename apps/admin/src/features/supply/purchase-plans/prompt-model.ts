import type {
  CreatePurchasePlanInput,
  InventoryProductReference,
} from '../../inventory/shared/types';

export type PromptFunction = (
  message: string,
  defaultValue?: string,
) => string | null;

export function collectPurchasePlanInput(
  product: InventoryProductReference,
  prompt: PromptFunction,
  now: () => number = Date.now,
): CreatePurchasePlanInput | null {
  const purchaseQuantityText = prompt(
    '请输入采购数量（例如 3 箱中的 3）',
    '1',
  );
  if (!purchaseQuantityText) return null;

  const purchaseUnit = prompt(
    '请输入采购单位（例如 箱 / 袋 / 件）',
    '箱',
  );
  if (!purchaseUnit) return null;

  const stockInQuantityText = prompt(
    `请输入折算后的入库库存数量（基础库存单位：${product.stock_unit}）`,
    String(
      Math.max(
        1,
        product.suggest_purchase_quantity ||
          product.stock_deduct_quantity ||
          1,
      ),
    ),
  );
  if (!stockInQuantityText) return null;

  const costPriceText = prompt('请输入每个采购单位成本（分）', '0');
  if (costPriceText === null) return null;

  return {
    target_date: new Date(now() + 24 * 60 * 60 * 1000).toISOString(),
    supplier_name: '默认供应商',
    remark: '后台创建采购计划：采购数量与入库库存数量分开记录',
    items: [
      {
        product_id: product.product_id,
        purchase_quantity: Number(purchaseQuantityText),
        purchase_unit: purchaseUnit,
        stock_in_quantity: Number(stockInQuantityText),
        cost_price_cents: Number(costPriceText),
        remark: `采购 ${purchaseQuantityText}${purchaseUnit}，入库 ${stockInQuantityText}${product.stock_unit}`,
      },
    ],
  };
}
