import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { deductInventoryForPaidOrder } from './inventory-order-service.js';

describe('deductInventoryForPaidOrder', () => {
  it('locks the order before checking the idempotency ledger', async () => {
    const calls: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async () => {
        calls.push('lock-order');
        return [{ id: 'order-1' }];
      }),
      stockLedger: {
        findUnique: vi.fn(async () => {
          calls.push('find-ledger');
          return {
            id: 'ledger-1',
            event_type: 'order_paid_deduct',
            quantity_delta: -1,
            quantity: 1,
            stock_before: 10,
            stock_after: 9,
          };
        }),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      deductInventoryForPaidOrder(tx, {
        order: {
          id: 'order-1',
          quantity: 1,
          product_id: 'product-1',
        },
      }),
    ).resolves.toMatchObject({
      applied: false,
      idempotent: true,
      ledger_id: 'ledger-1',
    });

    expect(calls).toEqual(['lock-order', 'find-ledger']);
  });
});
