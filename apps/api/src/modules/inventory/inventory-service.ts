import { Prisma } from '@prisma/client';

export async function lockStockForOrder(tx: Prisma.TransactionClient, input: {
  product_id: string;
  sale_quantity: number;
  user_id: string;
  order_id: string;
  group_buy_id: string;
  client_request_id?: string;
}) {
  const product = await tx.product.findUnique({ where: { id: input.product_id } });
  if (!product) throw new Error('商品不存在');
  const stockDeductQuantity = Math.max(1, product.stock_deduct_quantity ?? 1);
  const stockQuantity = input.sale_quantity * stockDeductQuantity;
  if (product.stock < stockQuantity) throw new Error('库存不足');
  const stockBefore = product.stock;
  const stockAfter = stockBefore - stockQuantity;
  await tx.product.update({ where: { id: input.product_id }, data: { stock: stockAfter } });
  await tx.stockLedger.create({
    data: {
      product_id: input.product_id,
      source_type: 'order_lock',
      source_id: input.order_id,
      direction: 'out',
      quantity: stockQuantity,
      stock_before: stockBefore,
      stock_after: stockAfter,
      operator_type: 'user',
      operator_id: input.user_id,
      remark: '订单锁定库存',
      payload: {
        group_buy_id: input.group_buy_id,
        client_request_id: input.client_request_id,
        sale_quantity: input.sale_quantity,
        sale_unit: product.sale_unit,
        sale_spec_name: product.sale_spec_name,
        stock_unit: product.stock_unit,
        stock_deduct_quantity: stockDeductQuantity
      }
    }
  });
  return {
    stock_before: stockBefore,
    stock_after: stockAfter,
    stock_quantity: stockQuantity,
    stock_unit: product.stock_unit,
    sale_quantity: input.sale_quantity,
    sale_unit: product.sale_unit,
    sale_spec_name: product.sale_spec_name,
    stock_deduct_quantity: stockDeductQuantity,
    product_id: input.product_id
  };
}

export async function adjustStockByAdmin(tx: Prisma.TransactionClient, input: {
  product_id: string;
  adjust_quantity: number;
  admin_user_id: string;
  reason: string;
}) {
  const product = await tx.product.findUnique({ where: { id: input.product_id } });
  if (!product) throw new Error('商品不存在');
  const stockAfter = product.stock + input.adjust_quantity;
  if (stockAfter < 0) throw new Error('库存不能调整为负数');
  const updated = await tx.product.update({ where: { id: input.product_id }, data: { stock: stockAfter } });
  await tx.stockLedger.create({
    data: {
      product_id: input.product_id,
      source_type: 'manual_adjust',
      source_id: input.product_id,
      direction: input.adjust_quantity > 0 ? 'in' : 'out',
      quantity: Math.abs(input.adjust_quantity),
      stock_before: product.stock,
      stock_after: stockAfter,
      operator_type: 'admin',
      operator_id: input.admin_user_id,
      remark: input.reason,
      payload: {
        adjust_quantity: input.adjust_quantity,
        stock_unit: product.stock_unit,
        sale_unit: product.sale_unit,
        sale_spec_name: product.sale_spec_name,
        stock_deduct_quantity: product.stock_deduct_quantity
      }
    }
  });
  return { product: updated, stock_before: product.stock, stock_after: stockAfter };
}

export async function receivePurchaseStock(tx: Prisma.TransactionClient, input: {
  product_id: string;
  purchase_plan_id: string;
  purchase_plan_item_id: string;
  received_quantity: number;
  admin_user_id: string;
  remark?: string | null;
  payload?: Record<string, unknown>;
}) {
  const product = await tx.product.findUnique({ where: { id: input.product_id } });
  if (!product) throw new Error('入库商品不存在');
  const stockAfter = product.stock + input.received_quantity;
  await tx.product.update({ where: { id: input.product_id }, data: { stock: { increment: input.received_quantity } } });
  await tx.stockLedger.create({
    data: {
      product_id: input.product_id,
      source_type: 'purchase_in',
      source_id: input.purchase_plan_id,
      direction: 'in',
      quantity: input.received_quantity,
      stock_before: product.stock,
      stock_after: stockAfter,
      operator_type: 'admin',
      operator_id: input.admin_user_id,
      remark: input.remark ?? null,
      payload: { purchase_plan_id: input.purchase_plan_id, purchase_plan_item_id: input.purchase_plan_item_id, stock_unit: product.stock_unit, ...(input.payload ?? {}) }
    }
  });
  return { product, stock_before: product.stock, stock_after: stockAfter, stock_unit: product.stock_unit };
}

export async function recordBatchLoss(tx: Prisma.TransactionClient, input: {
  batch_id: string;
  quantity: number;
  loss_type: string;
  reason: string;
  admin_user_id: string;
  responsible_type?: string;
  supplier_id?: string | null;
}) {
  const batch = await tx.productBatch.findUnique({ where: { id: input.batch_id } });
  if (!batch) throw new Error('批次不存在');
  if (batch.remaining_quantity < input.quantity) throw new Error('批次库存不足');
  const product = await tx.product.findUnique({ where: { id: batch.product_id } });
  if (!product) throw new Error('商品不存在');
  if (product.stock < input.quantity) throw new Error('商品库存不足');
  const batchAfter = batch.remaining_quantity - input.quantity;
  const productAfter = product.stock - input.quantity;
  const loss = await tx.inventoryLoss.create({
    data: {
      product_id: batch.product_id,
      batch_id: batch.id,
      loss_type: input.loss_type,
      quantity: input.quantity,
      stock_unit: batch.stock_unit,
      reason: input.reason,
      responsible_type: input.responsible_type ?? 'unknown',
      supplier_id: input.supplier_id ?? batch.supplier_id,
      operator_admin_id: input.admin_user_id,
      payload: { batch_no: batch.batch_no }
    }
  });
  await tx.productBatch.update({ where: { id: batch.id }, data: { remaining_quantity: batchAfter, status: batchAfter === 0 ? 'depleted' : batch.status } });
  await tx.product.update({ where: { id: batch.product_id }, data: { stock: productAfter } });
  await tx.batchStockLedger.create({ data: { batch_id: batch.id, product_id: batch.product_id, source_type: 'loss_out', source_id: loss.id, direction: 'out', quantity: input.quantity, batch_quantity_before: batch.remaining_quantity, batch_quantity_after: batchAfter, product_stock_before: product.stock, product_stock_after: productAfter, operator_type: 'admin', operator_id: input.admin_user_id, remark: input.reason, payload: { loss_type: input.loss_type, responsible_type: input.responsible_type ?? 'unknown' } } });
  await tx.stockLedger.create({ data: { product_id: batch.product_id, source_type: 'loss_out', source_id: loss.id, direction: 'out', quantity: input.quantity, stock_before: product.stock, stock_after: productAfter, operator_type: 'admin', operator_id: input.admin_user_id, remark: input.reason, payload: { batch_id: batch.id, batch_no: batch.batch_no, loss_type: input.loss_type, stock_unit: batch.stock_unit } } });
  return { loss, batch_before: batch.remaining_quantity, batch_after: batchAfter, stock_before: product.stock, stock_after: productAfter };
}

export async function confirmStockCheck(tx: Prisma.TransactionClient, input: { stock_check_id: string; admin_user_id: string }) {
  const current = await tx.stockCheck.findUnique({ where: { id: input.stock_check_id }, include: { items: true } });
  if (!current) throw new Error('盘点单不存在');
  if (current.status !== 'draft') throw new Error('仅草稿盘点可确认');
  for (const item of current.items) {
    if (item.diff_quantity === 0) continue;
    const direction = item.diff_quantity >= 0 ? 'in' : 'out';
    const quantity = Math.abs(item.diff_quantity);
    const product = await tx.product.findUnique({ where: { id: item.product_id } });
    if (!product) throw new Error('盘点商品不存在');
    const productAfter = product.stock + item.diff_quantity;
    if (productAfter < 0) throw new Error('盘点后商品库存不能为负数');
    if (item.batch_id) {
      const batch = await tx.productBatch.findUnique({ where: { id: item.batch_id } });
      if (!batch) throw new Error('盘点批次不存在');
      await tx.productBatch.update({ where: { id: batch.id }, data: { remaining_quantity: item.actual_quantity, status: item.actual_quantity === 0 ? 'depleted' : batch.status } });
      await tx.batchStockLedger.create({ data: { batch_id: batch.id, product_id: item.product_id, source_type: 'stock_check_adjust', source_id: current.id, direction, quantity, batch_quantity_before: batch.remaining_quantity, batch_quantity_after: item.actual_quantity, product_stock_before: product.stock, product_stock_after: productAfter, operator_type: 'admin', operator_id: input.admin_user_id, remark: item.reason, payload: { stock_check_item_id: item.id } } });
    }
    await tx.product.update({ where: { id: item.product_id }, data: { stock: productAfter } });
    await tx.stockLedger.create({ data: { product_id: item.product_id, source_type: 'stock_check_adjust', source_id: current.id, direction, quantity, stock_before: product.stock, stock_after: productAfter, operator_type: 'admin', operator_id: input.admin_user_id, remark: item.reason, payload: { stock_check_item_id: item.id, batch_id: item.batch_id, stock_unit: item.stock_unit } } });
  }
  return tx.stockCheck.update({ where: { id: input.stock_check_id }, data: { status: 'confirmed', confirmed_at: new Date() }, include: { items: true } });
}
