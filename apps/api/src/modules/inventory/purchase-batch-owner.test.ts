import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  createPurchaseBatch,
  loadPurchaseSupplierSnapshots,
} from './purchase-batch-owner.js';

function fixture() {
  const raw = {
    supplier: {
      findMany: vi.fn(async () => [
        { id: 'supplier-1', name: '供应商一', status: 'active' },
      ]),
    },
    productBatch: {
      create: vi.fn(
        async (_input: { data: { payload?: unknown } }) => ({
          id: 'batch-1',
          batch_no: 'PB1',
        }),
      ),
    },
    productBatchEvidence: {
      create: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'evidence-meta-1',
          evidence_fingerprint: 'c'.repeat(64),
        })
        .mockResolvedValueOnce({
          id: 'evidence-file-1',
          evidence_fingerprint: 'd'.repeat(64),
        }),
    },
    batchStockLedger: {
      create: vi.fn(
        async (_input: { data: { payload?: unknown } }) => ({
          id: 'batch-ledger-1',
        }),
      ),
    },
  };
  return { tx: raw as unknown as Prisma.TransactionClient, raw };
}

describe('purchase batch owner', () => {
  it('loads complete supplier snapshots and rejects a missing supplier', async () => {
    const current = fixture();
    await expect(
      loadPurchaseSupplierSnapshots(current.tx, [
        { item_id: 'item-1', supplier_id: 'supplier-1' },
      ]),
    ).resolves.toEqual(
      new Map([
        [
          'supplier-1',
          { id: 'supplier-1', name: '供应商一', status: 'active' },
        ],
      ]),
    );

    current.raw.supplier.findMany.mockResolvedValueOnce([]);
    await expect(
      loadPurchaseSupplierSnapshots(current.tx, [
        { item_id: 'item-1', supplier_id: 'missing' },
      ]),
    ).rejects.toThrow('供应商不存在');
  });

  it('creates a compatible batch and ledger from locked inventory values', async () => {
    const current = fixture();
    const result = await createPurchaseBatch(current.tx, {
      purchase_plan_id: 'plan-1',
      item: {
        item_id: 'item-1',
        product_id: 'product-1',
        product_name_snapshot: '青菜',
        received_quantity: 4,
        supplier_id: 'supplier-1',
        purchase_quantity: 1,
        purchase_unit: '箱',
        stock_in_quantity: 10,
        cost_price_cents: 100,
        production_date: new Date('2026-07-25'),
        arrival_date: new Date('2026-07-26'),
        shelf_life_days: 7,
        expire_at: new Date('2026-08-02'),
        remark: 'fresh',
      },
      supplier: { id: 'supplier-1', name: '供应商一', status: 'active' },
      inventory: {
        product_id: 'product-1',
        stock_before: 8,
        stock_after: 12,
        stock_unit: '斤',
        stock_ledger_id: 'ledger-1',
      },
      admin_user_id: 'admin-1',
      command_remark: 'receive',
    });

    expect(current.raw.productBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        product_id: 'product-1',
        supplier_id: 'supplier-1',
        purchase_plan_id: 'plan-1',
        purchase_plan_item_id: 'item-1',
        supplier_name_snapshot: '供应商一',
        initial_quantity: 4,
        remaining_quantity: 4,
        stock_unit: '斤',
        expire_at: new Date('2026-08-02'),
      }),
    });
    expect(current.raw.batchStockLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batch_id: 'batch-1',
        product_id: 'product-1',
        source_type: 'purchase_batch_in',
        source_id: 'plan-1',
        quantity: 4,
        batch_quantity_before: 0,
        batch_quantity_after: 4,
        product_stock_before: 8,
        product_stock_after: 12,
      }),
    });
    expect(result).toEqual({
      batch_id: 'batch-1',
      batch_no: 'PB1',
      batch_ledger_id: 'batch-ledger-1',
    });
  });

  it('persists traceability evidence outside batch and ledger payloads', async () => {
    const current = fixture();
    const objectKey = 'compliance/batches/proof.pdf';
    const paymentHash = 'b'.repeat(64);
    const fileHash = 'a'.repeat(64);
    const result = await createPurchaseBatch(current.tx, {
      purchase_plan_id: 'plan-1',
      item: {
        item_id: 'item-1',
        product_id: 'product-1',
        product_name_snapshot: '青菜',
        received_quantity: 4,
        supplier_id: 'supplier-1',
        purchase_quantity: 1,
        purchase_unit: '箱',
        stock_in_quantity: 10,
        cost_price_cents: 100,
        production_date: new Date('2026-07-25'),
        arrival_date: new Date('2026-07-26'),
        shelf_life_days: 7,
        expire_at: new Date('2026-08-02'),
        origin_text: '南京市江宁区',
        purchase_voucher_type: 'farmer_purchase_record',
        payment_reference_hash: paymentHash,
        invoice_evidence_status: 'agricultural_purchase_record',
        evidence: [
          {
            evidence_type: 'batch_proof',
            object_key: objectKey,
            file_sha256: fileHash,
            masked_summary: { document_no: '***1234' },
          },
        ],
      },
      supplier: { id: 'supplier-1', name: '供应商一', status: 'active' },
      inventory: {
        product_id: 'product-1',
        stock_before: 8,
        stock_after: 12,
        stock_unit: '斤',
        stock_ledger_id: 'ledger-1',
      },
      admin_user_id: 'admin-1',
      command_remark: 'receive',
    });

    expect(current.raw.productBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        origin_text: '南京市江宁区',
      }),
    });
    expect(current.raw.productBatchEvidence.create).toHaveBeenCalledTimes(2);
    expect(current.raw.productBatchEvidence.create).toHaveBeenNthCalledWith(
      1,
      {
        data: expect.objectContaining({
          batch_id: 'batch-1',
          evidence_type: 'purchase_traceability',
          payment_reference_hash: paymentHash,
          invoice_evidence_status: 'agricultural_purchase_record',
          masked_summary: {
            purchase_voucher_type: 'farmer_purchase_record',
          },
          created_by_admin_id: 'admin-1',
        }),
        select: { id: true, evidence_fingerprint: true },
      },
    );
    expect(current.raw.productBatchEvidence.create).toHaveBeenNthCalledWith(
      2,
      {
        data: expect.objectContaining({
          batch_id: 'batch-1',
          evidence_type: 'batch_proof',
          object_key: objectKey,
          file_sha256: fileHash,
          masked_summary: { document_no: '***1234' },
          created_by_admin_id: 'admin-1',
        }),
        select: { id: true, evidence_fingerprint: true },
      },
    );
    const batchData = current.raw.productBatch.create.mock.calls[0]?.[0];
    const ledgerData = current.raw.batchStockLedger.create.mock.calls[0]?.[0];
    expect(JSON.stringify([batchData?.data.payload, ledgerData?.data.payload])).not
      .toContain(objectKey);
    expect(JSON.stringify([batchData?.data.payload, ledgerData?.data.payload])).not
      .toContain(paymentHash);
    expect(result).toEqual({
      batch_id: 'batch-1',
      batch_no: 'PB1',
      batch_ledger_id: 'batch-ledger-1',
      evidence_ids: ['evidence-meta-1', 'evidence-file-1'],
      evidence_hashes: ['c'.repeat(64), 'd'.repeat(64)],
    });
  });

  it('skips zero quantity without batch side effects', async () => {
    const current = fixture();
    await expect(
      createPurchaseBatch(current.tx, {
        purchase_plan_id: 'plan-1',
        item: {
          item_id: 'item-1',
          product_id: 'product-1',
          product_name_snapshot: '青菜',
          received_quantity: 0,
          purchase_quantity: null,
          purchase_unit: null,
          stock_in_quantity: null,
          cost_price_cents: 100,
          production_date: null,
          arrival_date: new Date('2026-07-26'),
          shelf_life_days: undefined,
          expire_at: null,
        },
        supplier: null,
        inventory: null,
        admin_user_id: 'admin-1',
      }),
    ).resolves.toBeNull();
    expect(current.raw.productBatch.create).not.toHaveBeenCalled();
    expect(current.raw.batchStockLedger.create).not.toHaveBeenCalled();
  });
});
