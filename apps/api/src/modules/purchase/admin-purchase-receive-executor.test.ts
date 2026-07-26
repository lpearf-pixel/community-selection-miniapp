import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const tx = {
    adminCommandReceipt: {
      create: vi.fn(async () => {
        calls.push('create-receipt');
        return { id: 'receipt-1' };
      }),
      update: vi.fn(async () => {
        calls.push('complete-receipt');
        return {};
      }),
    },
  };
  return {
    calls,
    tx,
    prisma: {
      adminCommandReceipt: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    },
    lockPurchasePlan: vi.fn(async () => {
      calls.push('lock-plan');
      return { id: 'plan-1', status: 'confirmed', items: [] };
    }),
    validatePurchaseReceipt: vi.fn(() => {
      calls.push('validate-plan');
      return {
        ok: true,
        value: [
          {
            item_id: 'item-b',
            product_id: 'product-b',
            product_name_snapshot: 'B',
            received_quantity: 2,
            purchase_quantity: null,
            purchase_unit: null,
            stock_in_quantity: 2,
            cost_price_cents: 100,
            arrival_date: new Date('2026-07-26'),
            production_date: null,
            expire_at: null,
          },
          {
            item_id: 'item-a',
            product_id: 'product-a',
            product_name_snapshot: 'A',
            received_quantity: 1,
            purchase_quantity: null,
            purchase_unit: null,
            stock_in_quantity: 1,
            cost_price_cents: 100,
            arrival_date: new Date('2026-07-26'),
            production_date: null,
            expire_at: null,
          },
        ],
      };
    }),
    applyPurchaseReceipt: vi.fn(async () => {
      calls.push('apply-plan');
      return {
        id: 'plan-1',
        plan_no: 'PP1',
        status: 'received',
        target_date: new Date('2026-07-27T00:00:00.000Z'),
        created_at: new Date('2026-07-26T00:00:00.000Z'),
        items: [
          {
            id: 'item-a',
            product_id: 'product-a',
            planned_quantity: 1,
            received_quantity: 1,
            created_at: new Date('2026-07-26T00:00:00.000Z'),
          },
          {
            id: 'item-b',
            product_id: 'product-b',
            planned_quantity: 2,
            received_quantity: 2,
            created_at: new Date('2026-07-26T00:00:00.000Z'),
          },
        ],
      };
    }),
    loadPurchaseSupplierSnapshots: vi.fn(async () => {
      calls.push('load-suppliers');
      return new Map();
    }),
    receivePurchaseInventory: vi.fn(async (_tx, input) => {
      calls.push(`inventory:${input.product_id}`);
      return {
        product_id: input.product_id,
        stock_before: 0,
        stock_after: input.received_quantity,
        stock_unit: '件',
        stock_ledger_id: `ledger-${input.purchase_plan_item_id}`,
      };
    }),
    createPurchaseBatch: vi.fn(async (_tx, input) => {
      calls.push(`batch:${input.item.product_id}`);
      return {
        batch_id: `batch-${input.item.item_id}`,
        batch_no: `PB-${input.item.item_id}`,
        batch_ledger_id: `batch-ledger-${input.item.item_id}`,
      };
    }),
    recordAdminAudit: vi.fn(async (_tx, input) => {
      calls.push(`audit:${input.action}`);
    }),
  };
});

vi.mock('../../db.js', () => ({ prisma: mocks.prisma }));
vi.mock('../audit/audit-service.js', () => ({
  recordAdminAudit: mocks.recordAdminAudit,
}));
vi.mock('./purchase-plan-owner.js', () => ({
  lockPurchasePlan: mocks.lockPurchasePlan,
  validatePurchaseReceipt: mocks.validatePurchaseReceipt,
  applyPurchaseReceipt: mocks.applyPurchaseReceipt,
}));
vi.mock('../inventory/purchase-batch-owner.js', () => ({
  loadPurchaseSupplierSnapshots: mocks.loadPurchaseSupplierSnapshots,
  createPurchaseBatch: mocks.createPurchaseBatch,
}));
vi.mock('../inventory/purchase-inventory-owner.js', () => ({
  receivePurchaseInventory: mocks.receivePurchaseInventory,
}));

import {
  AdminPurchaseReceiveCommandError,
  executeAdminPurchaseReceiveCommand,
} from './admin-purchase-receive-executor.js';
import { buildAdminPurchaseReceiveRequestHash } from './admin-purchase-receive-command.js';

const command = {
  idempotency_key: 'purchase-receive-0001',
  remark: 'receive',
  items: [
    { item_id: 'item-b', received_quantity: 2 },
    { item_id: 'item-a', received_quantity: 1 },
  ],
};

const context = {
  admin_user_id: 'admin-1',
  role: 'admin',
  permissions: [],
  data_scope: 'all',
} as never;

describe('admin purchase receive executor', () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    vi.clearAllMocks();
    mocks.prisma.adminCommandReceipt.findUnique.mockResolvedValue(null);
  });

  it('orchestrates stable product order and completes the receipt last', async () => {
    const result = await executeAdminPurchaseReceiveCommand({
      purchase_plan_id: 'plan-1',
      command,
      context,
      admin_meta: {},
    });

    expect(result).toMatchObject({ id: 'plan-1', status: 'received' });
    expect(result.target_date).toBe('2026-07-27T00:00:00.000Z');
    expect(mocks.calls).toEqual([
      'create-receipt',
      'lock-plan',
      'validate-plan',
      'load-suppliers',
      'inventory:product-a',
      'batch:product-a',
      'inventory:product-b',
      'batch:product-b',
      'apply-plan',
      'audit:purchase_batch_created',
      'audit:purchase_batch_created',
      'audit:purchase_plan_received',
      'complete-receipt',
    ]);
  });

  it('replays only a complete matching receipt', async () => {
    const response = {
      id: 'plan-1',
      plan_no: 'PP1',
      status: 'received',
      items: [
        {
          id: 'item-a',
          product_id: 'product-a',
          planned_quantity: 1,
          received_quantity: 1,
        },
      ],
    };
    mocks.prisma.adminCommandReceipt.findUnique
      .mockResolvedValueOnce({ id: 'receipt-1' })
      .mockResolvedValueOnce({
        id: 'receipt-1',
        operation: 'admin.purchase-plan.receive.v1',
        target_id: 'plan-1',
        request_hash: buildAdminPurchaseReceiveRequestHash({
          purchase_plan_id: 'plan-1',
          command,
        }),
        completed_at: new Date(),
        response_http_status: 200,
        response_code: 'ADMIN_PURCHASE_PLAN_RECEIVED',
        response_data: response,
      });

    await expect(
      executeAdminPurchaseReceiveCommand({
        purchase_plan_id: 'plan-1',
        command,
        context,
        admin_meta: {},
      }),
    ).resolves.toEqual(response);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('exposes stable typed conflicts', () => {
    expect(
      new AdminPurchaseReceiveCommandError(
        409,
        'ADMIN_IDEMPOTENCY_KEY_REUSED',
        '幂等键已被其他命令使用',
      ),
    ).toMatchObject({
      name: 'AdminPurchaseReceiveCommandError',
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });
  });
});
