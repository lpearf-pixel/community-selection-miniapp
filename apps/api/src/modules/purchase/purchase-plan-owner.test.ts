import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  applyPurchaseReceipt,
  lockPurchasePlan,
  transitionPurchasePlan,
  validatePurchaseReceipt,
} from './purchase-plan-owner.js';

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    plan_no: 'PP1',
    status: 'confirmed',
    items: [
      {
        id: 'item-1',
        purchase_plan_id: 'plan-1',
        product_id: 'product-1',
        product_name_snapshot: '青菜',
        planned_quantity: 10,
        received_quantity: 2,
        purchase_quantity: 1,
        purchase_unit: '箱',
        stock_in_quantity: 10,
        cost_price_cents: 100,
        subtotal_cents: 100,
        remark: null,
      },
    ],
    ...overrides,
  };
}

function txWithPlan(value: ReturnType<typeof plan> | null) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => {
      calls.push('lock');
      return value ? [{ id: value.id }] : [];
    }),
    purchasePlan: {
      findUnique: vi.fn(async () => {
        calls.push('read');
        return value;
      }),
      update: vi.fn(async ({ data }: { data: { status: string } }) => ({
        ...value,
        status: data.status,
      })),
    },
    purchasePlanItem: {
      update: vi.fn(async () => ({})),
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, calls, raw: tx };
}

describe('purchase plan owner', () => {
  it('locks the purchase plan before loading current items', async () => {
    const fixture = txWithPlan(plan());

    const result = await lockPurchasePlan(fixture.tx, 'plan-1');

    expect(result.id).toBe('plan-1');
    expect(fixture.calls).toEqual(['lock', 'read']);
  });

  it('rejects a missing purchase plan after the lock query', async () => {
    const fixture = txWithPlan(null);

    await expect(lockPurchasePlan(fixture.tx, 'missing')).rejects.toThrow(
      '采购计划不存在',
    );
    expect(fixture.calls).toEqual(['lock', 'read']);
  });

  it('validates every receipt item without writing', () => {
    const locked = plan();
    expect(
      validatePurchaseReceipt(locked, {
        idempotency_key: 'purchase-receive-0001',
        items: [
          { item_id: 'item-1', received_quantity: 3 },
          { item_id: 'missing', received_quantity: 1 },
        ],
      }),
    ).toEqual({
      ok: false,
      message: '入库明细不存在',
    });
  });

  it('rejects stale state and cumulative over-receipt', () => {
    expect(
      validatePurchaseReceipt(plan({ status: 'cancelled' }), {
        idempotency_key: 'purchase-receive-0001',
        items: [{ item_id: 'item-1', received_quantity: 1 }],
      }),
    ).toEqual({
      ok: false,
      message: '仅已确认或已下单采购计划可入库',
    });
    expect(
      validatePurchaseReceipt(plan(), {
        idempotency_key: 'purchase-receive-0001',
        items: [{ item_id: 'item-1', received_quantity: 9 }],
      }),
    ).toEqual({
      ok: false,
      message: '累计入库数量不能超过计划数量',
    });
  });

  it('returns normalized validated rows from the locked snapshot', () => {
    const result = validatePurchaseReceipt(plan(), {
      idempotency_key: 'purchase-receive-0001',
      items: [
        {
          item_id: 'item-1',
          received_quantity: 3,
          arrival_date: '2026-07-26',
          production_date: '2026-07-25',
          shelf_life_days: 7,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          item_id: 'item-1',
          product_id: 'product-1',
          received_quantity: 3,
          arrival_date: new Date('2026-07-26'),
          production_date: new Date('2026-07-25'),
          expire_at: new Date('2026-08-02'),
        },
      ],
    });
  });

  it.each([
    { received: 5, planned: 10, status: 'ordered' },
    { received: 10, planned: 10, status: 'received' },
  ])('projects $status from current post-write totals', async (scenario) => {
    const fixture = txWithPlan(plan());
    fixture.raw.purchasePlan.findUnique
      .mockResolvedValueOnce(
        plan({
          items: [
            {
              ...plan().items[0],
              received_quantity: scenario.received,
              planned_quantity: scenario.planned,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        plan({
          status: scenario.status,
          items: [
            {
              ...plan().items[0],
              received_quantity: scenario.received,
              planned_quantity: scenario.planned,
            },
          ],
        }),
      );

    const result = await applyPurchaseReceipt(fixture.tx, {
      purchase_plan_id: 'plan-1',
      items: [{ item_id: 'item-1', received_quantity: 3 }],
    });

    expect(fixture.raw.purchasePlanItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { received_quantity: { increment: 3 } },
    });
    expect(fixture.raw.purchasePlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { status: scenario.status },
      include: { items: true },
    });
    expect(result.status).toBe(scenario.status);
  });

  it.each([
    { action: 'confirm' as const, status: 'draft', next: 'confirmed' },
    { action: 'cancel' as const, status: 'draft', next: 'cancelled' },
    { action: 'cancel' as const, status: 'confirmed', next: 'cancelled' },
  ])('locks before a valid $action transition', async (scenario) => {
    const fixture = txWithPlan(plan({ status: scenario.status }));

    const result = await transitionPurchasePlan(fixture.tx, {
      purchase_plan_id: 'plan-1',
      action: scenario.action,
    });

    expect(fixture.calls).toEqual(['lock', 'read']);
    expect(fixture.raw.purchasePlan.update).toHaveBeenCalledWith({
      where: { id: 'plan-1' },
      data: { status: scenario.next },
      include: { items: true },
    });
    expect(result.status).toBe(scenario.next);
  });

  it('rejects invalid lifecycle transitions after locking', async () => {
    const confirmFixture = txWithPlan(plan({ status: 'confirmed' }));
    await expect(
      transitionPurchasePlan(confirmFixture.tx, {
        purchase_plan_id: 'plan-1',
        action: 'confirm',
      }),
    ).rejects.toThrow('仅草稿采购计划可确认');

    const cancelFixture = txWithPlan(plan({ status: 'ordered' }));
    await expect(
      transitionPurchasePlan(cancelFixture.tx, {
        purchase_plan_id: 'plan-1',
        action: 'cancel',
      }),
    ).rejects.toThrow('当前采购计划不可取消');
  });
});
