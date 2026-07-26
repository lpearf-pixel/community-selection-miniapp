import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  deductInventoryForPaidOrder,
  restoreInventoryForRefund,
} from './inventory-order-service.js';

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

describe('restoreInventoryForRefund ownership', () => {
  it('restores stock without mutating the Refund projection', async () => {
    const refundUpdate = vi.fn();
    const tx = {
      refund: {
        findUnique: vi.fn(async () => ({
          id: 'refund-1',
          order_id: 'order-1',
          status: 'success',
          product_refund_amount_cents: 1000,
          delivery_refund_amount_cents: 0,
          order: {
            id: 'order-1',
            pay_status: 'paid',
            product_id: 'product-1',
            group_buy: null,
            product_amount_cents: 1000,
            total_amount_cents: 1000,
            product_refund_amount_cents: 1000,
          },
        })),
        update: refundUpdate,
      },
      stockLedger: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => [{
          event_type: 'order_paid_deduct',
          source_type: 'order_payment',
          quantity_delta: -2,
          quantity: 2,
          direction: 'out',
        }]),
        create: vi.fn(async () => ({ id: 'ledger-restore-1' })),
      },
      product: {
        findUnique: vi.fn(async () => ({ id: 'product-1', stock: 8 })),
        update: vi.fn(async () => ({ id: 'product-1', stock: 10 })),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'product-1',
          stock: 10,
        })),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      restoreInventoryForRefund(tx, { refund_id: 'refund-1' }),
    ).resolves.toMatchObject({
      applied: true,
      idempotent: false,
      quantity: 2,
      ledger_id: 'ledger-restore-1',
    });
    expect(refundUpdate).not.toHaveBeenCalled();
  });
});
