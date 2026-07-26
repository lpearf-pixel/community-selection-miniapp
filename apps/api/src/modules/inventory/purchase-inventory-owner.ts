import type { Prisma } from '@prisma/client';

export type PurchaseInventoryResult = {
  product_id: string;
  stock_before: number;
  stock_after: number;
  stock_unit: string;
  stock_ledger_id: string;
};

export async function receivePurchaseInventory(
  tx: Prisma.TransactionClient,
  input: {
    receipt_id: string;
    purchase_plan_id: string;
    purchase_plan_item_id: string;
    product_id: string;
    received_quantity: number;
    admin_user_id: string;
    remark?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<PurchaseInventoryResult> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM "Product"
    WHERE id = ${input.product_id}
    FOR UPDATE
  `;
  const product = await tx.product.findUnique({
    where: { id: input.product_id },
  });
  if (!product) throw new Error('入库商品不存在');
  const stockAfter = product.stock + input.received_quantity;
  if (!Number.isSafeInteger(stockAfter)) throw new Error('入库数量不合法');
  await tx.product.update({
    where: { id: input.product_id },
    data: { stock: { increment: input.received_quantity } },
  });
  const ledger = await tx.stockLedger.create({
    data: {
      product_id: input.product_id,
      source_type: 'purchase_in',
      source_id: input.purchase_plan_id,
      idempotency_key: `purchase-receive:${input.receipt_id}:${input.purchase_plan_item_id}`,
      event_type: 'purchase_receive',
      quantity_delta: input.received_quantity,
      direction: 'in',
      quantity: input.received_quantity,
      stock_before: product.stock,
      stock_after: stockAfter,
      operator_type: 'admin',
      operator_id: input.admin_user_id,
      remark: input.remark ?? null,
      payload: {
        purchase_plan_id: input.purchase_plan_id,
        purchase_plan_item_id: input.purchase_plan_item_id,
        stock_unit: product.stock_unit,
        ...(input.payload ?? {}),
      },
    },
  });
  return {
    product_id: product.id,
    stock_before: product.stock,
    stock_after: stockAfter,
    stock_unit: product.stock_unit,
    stock_ledger_id: ledger.id,
  };
}
