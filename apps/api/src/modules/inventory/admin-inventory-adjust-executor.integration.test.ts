import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import {
  executeAdminInventoryAdjustCommand,
} from './admin-inventory-adjust-executor.js';
import { buildAdminInventoryAdjustRequestHash } from './admin-inventory-adjust-command.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `c2t3c-admin-${suffix}`,
  category: `C2T3C category ${suffix}`,
  product: `C2T3C product ${suffix}`,
};
let categoryId = '';
let productId = '';

const context: AdminAccessContext = {
  admin_user_id: ids.admin,
  role: 'super_admin',
  permissions: ['admin.full_access'],
  is_super_admin: true,
  data_scope: {
    pickup_store_ids: [],
    community_ids: [],
    can_access_all_pickup_stores: true,
    can_access_all_communities: true,
  },
  data_scope_source: 'session',
};

function input(
  key: string,
  overrides: {
    product_id?: string;
    expected_stock?: number;
    adjust_quantity?: number;
    reason?: string;
    admin_user_id?: string;
  } = {},
) {
  return {
    product_id: overrides.product_id ?? productId,
    command: {
      expected_stock: overrides.expected_stock ?? 20,
      adjust_quantity: overrides.adjust_quantity ?? -3,
      reason: overrides.reason ?? '门店盘点差异',
      idempotency_key: key,
    },
    context: {
      ...context,
      admin_user_id: overrides.admin_user_id ?? context.admin_user_id,
    },
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'c2t3c-integration',
    },
  };
}

async function counts() {
  const [ledgers, events, audits, receipts] = await Promise.all([
    prisma.stockLedger.count({
      where: { product_id: productId, event_type: 'manual_adjust' },
    }),
    prisma.businessEventLog.count({
      where: {
        event_type: 'inventory_manual_adjusted',
        event_source: 'admin-inventory-adjust-command',
      },
    }),
    prisma.adminAuditLog.count({
      where: {
        target_type: 'Product',
        target_id: productId,
        action: 'inventory_manual_adjusted',
      },
    }),
    prisma.adminCommandReceipt.count({
      where: { admin_user_id: ids.admin },
    }),
  ]);
  return { ledgers, events, audits, receipts };
}

async function installFailureTrigger(
  table: 'StockLedger' | 'BusinessEventLog' | 'AdminAuditLog' | 'AdminCommandReceipt',
) {
  const slug = table.toLowerCase();
  const trigger = `c2t3c_fail_${slug}`;
  const failure = `c2t3c_raise_${slug}`;
  const operation = table === 'AdminCommandReceipt' ? 'UPDATE' : 'INSERT';
  const condition =
    table === 'StockLedger'
      ? `IF NEW.event_type = 'manual_adjust' THEN`
      : table === 'BusinessEventLog'
        ? `IF NEW.event_type = 'inventory_manual_adjusted' THEN`
        : table === 'AdminAuditLog'
          ? `IF NEW.action = 'inventory_manual_adjusted' THEN`
          : `IF NEW.response_code = 'ADMIN_INVENTORY_ADJUSTED' THEN`;
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "${table}"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${failure}()`);
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${failure}() RETURNS trigger AS $c2t3c$
     BEGIN
       ${condition}
         RAISE EXCEPTION 'forced ${table} failure';
       END IF;
       RETURN NEW;
     END;
     $c2t3c$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${trigger}
     BEFORE ${operation} ON "${table}"
     FOR EACH ROW EXECUTE FUNCTION ${failure}()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trigger} ON "${table}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${failure}()`);
  };
}

beforeAll(async () => {
  await prisma.adminUser.create({
    data: {
      id: ids.admin,
      username: ids.admin,
      password_hash: 'integration-only',
      status: 'active',
    },
  });
  const category = await prisma.category.create({
    data: { name: ids.category },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      name: ids.product,
      category_id: category.id,
      price_cents: 100,
      cost_price_cents: 50,
      stock: 20,
      unit: '份',
      stock_unit: '份',
      status: 'active',
    },
  });
  productId = product.id;
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.stockLedger.deleteMany({ where: { product_id: productId } }),
    prisma.businessEventLog.deleteMany({
      where: {
        event_type: 'inventory_manual_adjusted',
        event_source: 'admin-inventory-adjust-command',
      },
    }),
    prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Product', target_id: productId },
    }),
    prisma.adminCommandReceipt.deleteMany({
      where: {
        admin_user_id: {
          in: [ids.admin, `missing-${ids.admin}`],
        },
      },
    }),
    prisma.product.update({
      where: { id: productId },
      data: { stock: 20 },
    }),
  ]);
});

afterAll(async () => {
  if (productId) {
    await prisma.stockLedger.deleteMany({ where: { product_id: productId } });
    await prisma.businessEventLog.deleteMany({
      where: {
        event_type: 'inventory_manual_adjusted',
        event_source: 'admin-inventory-adjust-command',
      },
    });
    await prisma.adminAuditLog.deleteMany({
      where: { target_type: 'Product', target_id: productId },
    });
    await prisma.adminCommandReceipt.deleteMany({
      where: {
        admin_user_id: {
          in: [ids.admin, `missing-${ids.admin}`],
        },
      },
    });
    await prisma.product.deleteMany({ where: { id: productId } });
  }
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('Admin inventory adjustment executor on PostgreSQL', () => {
  it('adjusts stock once and replays the stable result', async () => {
    const command = input('inventory-adjust-success-0001');
    const first = await executeAdminInventoryAdjustCommand(command);
    const replay = await executeAdminInventoryAdjustCommand(command);

    expect(first).toEqual({
      product_id: productId,
      stock_before: 20,
      stock_after: 17,
      adjust_quantity: -3,
      stock_unit: '份',
    });
    expect(replay).toEqual(first);
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: productId } }),
    ).resolves.toMatchObject({ stock: 17 });
    await expect(counts()).resolves.toEqual({
      ledgers: 1,
      events: 1,
      audits: 1,
      receipts: 1,
    });
  });

  it('supports positive adjustment and a target stock of zero', async () => {
    await executeAdminInventoryAdjustCommand(
      input('inventory-adjust-positive-001', { adjust_quantity: 2 }),
    );
    await prisma.product.update({ where: { id: productId }, data: { stock: 3 } });
    const zero = await executeAdminInventoryAdjustCommand(
      input('inventory-adjust-zero-000001', {
        expected_stock: 3,
        adjust_quantity: -3,
      }),
    );

    expect(zero.stock_after).toBe(0);
  });

  it('rejects missing and stale products without side effects', async () => {
    await expect(
      executeAdminInventoryAdjustCommand(
        input('inventory-adjust-missing-001', { product_id: 'missing-product' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'ADMIN_INVENTORY_PRODUCT_NOT_FOUND',
    });
    await expect(
      executeAdminInventoryAdjustCommand(
        input('inventory-adjust-stale-00001', { expected_stock: 19 }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_INVENTORY_STOCK_CONFLICT',
    });
    await expect(counts()).resolves.toEqual({
      ledgers: 0,
      events: 0,
      audits: 0,
      receipts: 0,
    });
  });

  it('rejects same-key drift and two-key races without duplicate effects', async () => {
    await executeAdminInventoryAdjustCommand(
      input('inventory-adjust-reuse-0001'),
    );
    await expect(
      executeAdminInventoryAdjustCommand(
        input('inventory-adjust-reuse-0001', { reason: '不同原因' }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_IDEMPOTENCY_KEY_REUSED',
    });

    await prisma.$transaction([
      prisma.stockLedger.deleteMany({ where: { product_id: productId } }),
      prisma.businessEventLog.deleteMany({
        where: { event_type: 'inventory_manual_adjusted' },
      }),
      prisma.adminAuditLog.deleteMany({
        where: { target_type: 'Product', target_id: productId },
      }),
      prisma.adminCommandReceipt.deleteMany({ where: { admin_user_id: ids.admin } }),
      prisma.product.update({ where: { id: productId }, data: { stock: 20 } }),
    ]);
    const settled = await Promise.allSettled([
      executeAdminInventoryAdjustCommand(input('inventory-adjust-race-00001')),
      executeAdminInventoryAdjustCommand(input('inventory-adjust-race-00002')),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(settled.find((item) => item.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        statusCode: 409,
        code: 'ADMIN_INVENTORY_STOCK_CONFLICT',
      }),
    });
    await expect(counts()).resolves.toEqual({
      ledgers: 1,
      events: 1,
      audits: 1,
      receipts: 1,
    });
  });

  it('fails closed for an incomplete receipt without re-executing', async () => {
    const key = 'inventory-adjust-incomplete-01';
    await prisma.adminCommandReceipt.create({
      data: {
        admin_user_id: ids.admin,
        idempotency_key: key,
        operation: 'admin.inventory.product.adjust.v1',
        target_id: productId,
        request_hash: buildAdminInventoryAdjustRequestHash({
          product_id: productId,
          expected_stock: 20,
          adjust_quantity: -3,
          reason: '门店盘点差异',
        }),
      },
    });

    await expect(
      executeAdminInventoryAdjustCommand(input(key)),
    ).rejects.toMatchObject({
      statusCode: 500,
      code: 'ADMIN_INVENTORY_ADJUST_FAILED',
    });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: productId } }),
    ).resolves.toMatchObject({ stock: 20 });
    await expect(counts()).resolves.toEqual({
      ledgers: 0,
      events: 0,
      audits: 0,
      receipts: 1,
    });
  });

  it('writes one root event regardless of unrelated event history', async () => {
    await prisma.businessEventLog.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        event_type: `unrelated-${index}`,
        event_source: 'integration-history',
      })),
    });
    await executeAdminInventoryAdjustCommand(
      input('inventory-adjust-o1-event-001'),
    );

    await expect(
      prisma.businessEventLog.count({
        where: {
          event_type: 'inventory_manual_adjusted',
          event_source: 'admin-inventory-adjust-command',
        },
      }),
    ).resolves.toBe(1);
    await prisma.businessEventLog.deleteMany({
      where: { event_source: 'integration-history' },
    });
  });

  it.each([
    'StockLedger',
    'BusinessEventLog',
    'AdminAuditLog',
    'AdminCommandReceipt',
  ] as const)('rolls back every write when %s fails', async (table) => {
    const removeTrigger = await installFailureTrigger(table);
    try {
      await expect(
        executeAdminInventoryAdjustCommand(
          input(`inventory-rollback-${table.toLowerCase()}`),
        ),
      ).rejects.toBeTruthy();
    } finally {
      await removeTrigger();
    }

    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: productId } }),
    ).resolves.toMatchObject({ stock: 20 });
    await expect(counts()).resolves.toEqual({
      ledgers: 0,
      events: 0,
      audits: 0,
      receipts: 0,
    });
  });
});
