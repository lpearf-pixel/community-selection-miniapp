import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { receivePurchaseInventory } from './purchase-inventory-owner.js';

function fixture(product: Record<string, unknown> | null = {
  id: 'product-1',
  stock: 8,
  stock_unit: '斤',
  sale_unit: '份',
  sale_spec_name: '500g',
  stock_deduct_quantity: 1,
}) {
  const calls: string[] = [];
  const raw = {
    $queryRaw: vi.fn(async () => {
      calls.push('lock');
      return product ? [{ id: product.id }] : [];
    }),
    product: {
      findUnique: vi.fn(async () => {
        calls.push('read');
        return product;
      }),
      update: vi.fn(async () => ({ ...product, stock: 12 })),
    },
    stockLedger: {
      create: vi.fn(async () => ({ id: 'ledger-1' })),
    },
  };
  return {
    tx: raw as unknown as Prisma.TransactionClient,
    raw,
    calls,
  };
}

describe('purchase inventory owner', () => {
  it('locks the product before deriving continuous ledger values', async () => {
    const current = fixture();

    const result = await receivePurchaseInventory(current.tx, {
      receipt_id: 'receipt-1',
      purchase_plan_id: 'plan-1',
      purchase_plan_item_id: 'item-1',
      product_id: 'product-1',
      received_quantity: 4,
      admin_user_id: 'admin-1',
      remark: 'receive',
      payload: { purchase_unit: '箱' },
    });

    expect(current.calls).toEqual(['lock', 'read']);
    expect(current.raw.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { stock: { increment: 4 } },
    });
    expect(current.raw.stockLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        product_id: 'product-1',
        source_type: 'purchase_in',
        source_id: 'plan-1',
        idempotency_key: 'purchase-receive:receipt-1:item-1',
        event_type: 'purchase_receive',
        quantity_delta: 4,
        direction: 'in',
        quantity: 4,
        stock_before: 8,
        stock_after: 12,
        payload: {
          purchase_plan_id: 'plan-1',
          purchase_plan_item_id: 'item-1',
          stock_unit: '斤',
          purchase_unit: '箱',
        },
      }),
    });
    expect(result).toEqual({
      product_id: 'product-1',
      stock_before: 8,
      stock_after: 12,
      stock_unit: '斤',
      stock_ledger_id: 'ledger-1',
    });
  });

  it('rejects a missing product without stock or ledger writes', async () => {
    const current = fixture(null);
    await expect(
      receivePurchaseInventory(current.tx, {
        receipt_id: 'receipt-1',
        purchase_plan_id: 'plan-1',
        purchase_plan_item_id: 'item-1',
        product_id: 'missing',
        received_quantity: 4,
        admin_user_id: 'admin-1',
      }),
    ).rejects.toThrow('入库商品不存在');
    expect(current.raw.product.update).not.toHaveBeenCalled();
    expect(current.raw.stockLedger.create).not.toHaveBeenCalled();
  });
});
