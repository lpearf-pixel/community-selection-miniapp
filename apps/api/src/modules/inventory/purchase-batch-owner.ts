import type { Prisma } from '@prisma/client';
import type { ValidatedReceiptItem } from '../purchase/purchase-plan-owner.js';
import type { PurchaseInventoryResult } from './purchase-inventory-owner.js';
import { persistProductBatchEvidence } from '../compliance/product-batch-evidence.js';

export type SupplierSnapshot = {
  id: string;
  name: string;
  status: string;
};

export type PurchaseBatchResult = {
  batch_id: string;
  batch_no: string;
  batch_ledger_id: string;
  evidence_ids?: string[];
  evidence_hashes?: string[];
};

function makeBatchNo() {
  return `PB${Date.now()}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')}`;
}

export async function loadPurchaseSupplierSnapshots(
  tx: Prisma.TransactionClient,
  items: Array<{ item_id: string; supplier_id?: string }>,
): Promise<Map<string, SupplierSnapshot>> {
  const ids = [...new Set(items.flatMap((item) => item.supplier_id ?? []))];
  if (ids.length === 0) return new Map();
  const suppliers = await tx.supplier.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, status: true },
  });
  const snapshots = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  if (ids.some((id) => !snapshots.has(id))) throw new Error('供应商不存在');
  return snapshots;
}

export async function createPurchaseBatch(
  tx: Prisma.TransactionClient,
  input: {
    purchase_plan_id: string;
    item: ValidatedReceiptItem;
    supplier: SupplierSnapshot | null;
    inventory: PurchaseInventoryResult | null;
    admin_user_id: string;
    command_remark?: string | null;
  },
): Promise<PurchaseBatchResult | null> {
  if (input.item.received_quantity <= 0) return null;
  if (!input.inventory) throw new Error('入库库存结果不存在');
  const batch = await tx.productBatch.create({
    data: {
      batch_no: makeBatchNo(),
      product_id: input.item.product_id,
      supplier_id: input.supplier?.id ?? null,
      purchase_plan_id: input.purchase_plan_id,
      purchase_plan_item_id: input.item.item_id,
      product_name_snapshot: input.item.product_name_snapshot,
      supplier_name_snapshot: input.supplier?.name ?? null,
      stock_unit: input.inventory.stock_unit,
      initial_quantity: input.item.received_quantity,
      remaining_quantity: input.item.received_quantity,
      cost_price_cents: input.item.cost_price_cents,
      origin_text: input.item.origin_text ?? null,
      production_date: input.item.production_date,
      arrival_date: input.item.arrival_date,
      shelf_life_days: input.item.shelf_life_days ?? null,
      expire_at: input.item.expire_at,
      status: 'active',
      remark: input.item.remark ?? input.command_remark ?? null,
      payload: {
        purchase_unit: input.item.purchase_unit,
        purchase_quantity: input.item.purchase_quantity,
        stock_in_quantity: input.item.stock_in_quantity,
      },
    },
  });
  const evidence = await persistProductBatchEvidence(tx, {
    batch_id: batch.id,
    created_by_admin_id: input.admin_user_id,
    fields: {
      ...(input.item.origin_text
        ? { origin_text: input.item.origin_text }
        : {}),
      ...(input.item.purchase_voucher_type
        ? { purchase_voucher_type: input.item.purchase_voucher_type }
        : {}),
      ...(input.item.payment_reference_hash
        ? { payment_reference_hash: input.item.payment_reference_hash }
        : {}),
      ...(input.item.invoice_evidence_status
        ? { invoice_evidence_status: input.item.invoice_evidence_status }
        : {}),
      ...(input.item.evidence ? { evidence: input.item.evidence } : {}),
    },
  });
  const ledger = await tx.batchStockLedger.create({
    data: {
      batch_id: batch.id,
      product_id: input.item.product_id,
      source_type: 'purchase_batch_in',
      source_id: input.purchase_plan_id,
      direction: 'in',
      quantity: input.item.received_quantity,
      batch_quantity_before: 0,
      batch_quantity_after: input.item.received_quantity,
      product_stock_before: input.inventory.stock_before,
      product_stock_after: input.inventory.stock_after,
      operator_type: 'admin',
      operator_id: input.admin_user_id,
      remark: input.item.remark ?? input.command_remark ?? null,
      payload: {
        purchase_plan_item_id: input.item.item_id,
        supplier_id: input.supplier?.id ?? null,
        expire_at: input.item.expire_at?.toISOString() ?? null,
        stock_ledger_id: input.inventory.stock_ledger_id,
      },
    },
  });
  return {
    batch_id: batch.id,
    batch_no: batch.batch_no,
    batch_ledger_id: ledger.id,
    ...(evidence.evidence_ids.length === 0 ? {} : evidence),
  };
}
