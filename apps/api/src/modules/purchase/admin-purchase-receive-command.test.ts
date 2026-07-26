import { describe, expect, it } from 'vitest';
import {
  buildAdminPurchaseReceiveRequestHash,
  isAdminPurchaseReceiveResult,
  parseAdminPurchaseReceiveCommand,
} from './admin-purchase-receive-command.js';

const validBody = {
  idempotency_key: 'purchase-receive-0001',
  remark: '后台采购入库',
  items: [{ item_id: 'item-1', received_quantity: 4 }],
};

describe('admin purchase receive command', () => {
  it.each([null, [], 'body', 1])('rejects a non-object body: %j', (body) => {
    expect(parseAdminPurchaseReceiveCommand(body)).toEqual({
      ok: false,
      code: 'INVALID_ADMIN_PURCHASE_RECEIVE_COMMAND',
      message: '采购入库命令不合法',
    });
  });

  it('rejects unknown root and item fields', () => {
    expect(
      parseAdminPurchaseReceiveCommand({ ...validBody, unexpected: true }),
    ).toMatchObject({ ok: false });
    expect(
      parseAdminPurchaseReceiveCommand({
        ...validBody,
        items: [{ ...validBody.items[0], unexpected: true }],
      }),
    ).toMatchObject({ ok: false });
  });

  it.each([
    undefined,
    'short',
    ' purchase-receive-0001',
    'purchase-receive-0001 ',
    '采购入库-purchase-receive-0001',
    'purchase\nreceive-0001',
  ])('rejects an invalid idempotency key: %j', (idempotency_key) => {
    expect(
      parseAdminPurchaseReceiveCommand({ ...validBody, idempotency_key }),
    ).toMatchObject({ ok: false });
  });

  it('rejects empty or duplicate items', () => {
    expect(
      parseAdminPurchaseReceiveCommand({ ...validBody, items: [] }),
    ).toMatchObject({ ok: false });
    expect(
      parseAdminPurchaseReceiveCommand({
        ...validBody,
        items: [
          { item_id: 'item-1', received_quantity: 1 },
          { item_id: 'item-1', received_quantity: 2 },
        ],
      }),
    ).toMatchObject({ ok: false });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid received quantity: %j',
    (received_quantity) => {
      expect(
        parseAdminPurchaseReceiveCommand({
          ...validBody,
          items: [{ item_id: 'item-1', received_quantity }],
        }),
      ).toMatchObject({ ok: false });
    },
  );

  it.each([
    { arrival_date: 'not-a-date' },
    { production_date: 'not-a-date' },
    { shelf_life_days: 0 },
    { shelf_life_days: 1.5 },
    { supplier_id: '' },
    { remark: '\u0000' },
  ])('rejects invalid optional item fields: %j', (fields) => {
    expect(
      parseAdminPurchaseReceiveCommand({
        ...validBody,
        items: [{ ...validBody.items[0], ...fields }],
      }),
    ).toMatchObject({ ok: false });
  });

  it('normalizes a valid command without inventing optional values', () => {
    expect(parseAdminPurchaseReceiveCommand(validBody)).toEqual({
      ok: true,
      value: {
        idempotency_key: 'purchase-receive-0001',
        remark: '后台采购入库',
        items: [
          {
            item_id: 'item-1',
            received_quantity: 4,
            supplier_id: undefined,
            production_date: undefined,
            arrival_date: undefined,
            shelf_life_days: undefined,
            remark: undefined,
          },
        ],
      },
    });
  });

  it('preserves item order and hashes every semantic field', () => {
    const base = {
      purchase_plan_id: 'plan-1',
      command: {
        idempotency_key: 'purchase-receive-0001',
        remark: 'receive',
        items: [
          {
            item_id: 'item-1',
            received_quantity: 2,
            supplier_id: 'supplier-1',
            production_date: '2026-07-01',
            arrival_date: '2026-07-26',
            shelf_life_days: 30,
            remark: 'fresh',
          },
          {
            item_id: 'item-2',
            received_quantity: 1,
            supplier_id: undefined,
            production_date: undefined,
            arrival_date: undefined,
            shelf_life_days: undefined,
            remark: undefined,
          },
        ],
      },
    };
    const hash = buildAdminPurchaseReceiveRequestHash(base);
    const variants = [
      { ...base, purchase_plan_id: 'plan-2' },
      {
        ...base,
        command: { ...base.command, remark: 'changed' },
      },
      {
        ...base,
        command: { ...base.command, items: [...base.command.items].reverse() },
      },
      {
        ...base,
        command: {
          ...base.command,
          items: [
            { ...base.command.items[0], received_quantity: 3 },
            base.command.items[1],
          ],
        },
      },
    ];

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      variants.map((variant) => buildAdminPurchaseReceiveRequestHash(variant)),
    ).not.toContain(hash);
  });

  it('accepts only a complete result for the requested purchase plan', () => {
    const result = {
      id: 'plan-1',
      plan_no: 'PP1',
      status: 'ordered',
      items: [
        {
          id: 'item-1',
          product_id: 'product-1',
          planned_quantity: 10,
          received_quantity: 4,
        },
      ],
    };

    expect(isAdminPurchaseReceiveResult(result, 'plan-1')).toBe(true);
    expect(isAdminPurchaseReceiveResult(result, 'plan-2')).toBe(false);
    expect(
      isAdminPurchaseReceiveResult(
        { ...result, items: [{ ...result.items[0], received_quantity: 1.5 }] },
        'plan-1',
      ),
    ).toBe(false);
  });
});
