import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { prisma } from '../../db.js';
import { cancelPurchasePlan } from './purchase-service.js';
import { executeAdminPurchaseReceiveCommand } from './admin-purchase-receive-executor.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  admin: `l50c3-purchase-admin-${suffix}`,
  category: `l50c3-purchase-category-${suffix}`,
  productA: `l50c3-purchase-product-a-${suffix}`,
  productB: `l50c3-purchase-product-b-${suffix}`,
};
const planIds: string[] = [];

function key(label: string) {
  return `purchase-receive-${label}-${suffix}`;
}

async function createPlan(
  label: string,
  items: Array<{ product_id: string; planned_quantity: number }>,
) {
  const plan = await prisma.purchasePlan.create({
    data: {
      plan_no: `L50C3-P-${label}-${suffix}`,
      status: 'confirmed',
      target_date: new Date(Date.now() + 86_400_000),
      created_by_admin_id: ids.admin,
      total_quantity: items.reduce(
        (sum, item) => sum + item.planned_quantity,
        0,
      ),
      total_amount_cents: items.reduce(
        (sum, item) => sum + item.planned_quantity * 10,
        0,
      ),
      items: {
        create: items.map((item, index) => ({
          product_id: item.product_id,
          product_name_snapshot:
            item.product_id === ids.productA ? 'A' : 'B',
          planned_quantity: item.planned_quantity,
          stock_in_quantity: item.planned_quantity,
          cost_price_cents: 10,
          subtotal_cents: item.planned_quantity * 10,
          remark: `item-${index}`,
        })),
      },
    },
    include: { items: true },
  });
  planIds.push(plan.id);
  return plan;
}

function receiveInput(
  plan: Awaited<ReturnType<typeof createPlan>>,
  label: string,
  quantities: number[],
) {
  return {
    purchase_plan_id: plan.id,
    command: {
      idempotency_key: key(label),
      remark: `receive-${label}`,
      items: plan.items.map((item, index) => ({
        item_id: item.id,
        received_quantity: quantities[index] ?? 0,
        arrival_date: '2026-07-26',
      })),
    },
    context: { admin_user_id: ids.admin },
    admin_meta: {
      ip_address: '127.0.0.1',
      user_agent: 'l50-c3-purchase-integration',
    },
  };
}

async function counts(planId: string) {
  const [stock, batches, batchLedgers, audits, receipts] = await Promise.all([
    prisma.stockLedger.count({
      where: { source_type: 'purchase_in', source_id: planId },
    }),
    prisma.productBatch.count({ where: { purchase_plan_id: planId } }),
    prisma.batchStockLedger.count({
      where: { source_type: 'purchase_batch_in', source_id: planId },
    }),
    prisma.adminAuditLog.count({
      where: {
        OR: [
          {
            action: 'purchase_plan_received',
            target_id: planId,
          },
          {
            action: 'purchase_batch_created',
            payload: { path: ['purchase_plan_id'], equals: planId },
          },
        ],
      },
    }),
    prisma.adminCommandReceipt.count({
      where: {
        admin_user_id: ids.admin,
        operation: 'admin.purchase-plan.receive.v1',
        target_id: planId,
      },
    }),
  ]);
  return { stock, batches, batchLedgers, audits, receipts };
}

async function installAuditFailure() {
  const trigger = `l50c3_purchase_audit_${Date.now()}`;
  const failure = `${trigger}_fn`;
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION ${failure}() RETURNS trigger AS $l50c3$
     BEGIN
       IF NEW.action = 'purchase_plan_received' THEN
         RAISE EXCEPTION 'forced purchase audit failure';
       END IF;
       RETURN NEW;
     END;
     $l50c3$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${trigger}
     BEFORE INSERT ON "AdminAuditLog"
     FOR EACH ROW EXECUTE FUNCTION ${failure}()`,
  );
  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${trigger} ON "AdminAuditLog"`,
    );
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
  await prisma.category.create({
    data: { id: ids.category, name: ids.category },
  });
  await prisma.product.createMany({
    data: [
      {
        id: ids.productA,
        name: ids.productA,
        category_id: ids.category,
        price_cents: 100,
        cost_price_cents: 50,
        stock: 0,
        unit: '件',
        stock_unit: '件',
        status: 'active',
      },
      {
        id: ids.productB,
        name: ids.productB,
        category_id: ids.category,
        price_cents: 100,
        cost_price_cents: 50,
        stock: 0,
        unit: '件',
        stock_unit: '件',
        status: 'active',
      },
    ],
  });
});

afterAll(async () => {
  const batches = await prisma.productBatch.findMany({
    where: { purchase_plan_id: { in: planIds } },
    select: { id: true },
  });
  const batchIds = batches.map((item) => item.id);
  await prisma.batchStockLedger.deleteMany({
    where: { batch_id: { in: batchIds } },
  });
  await prisma.productBatch.deleteMany({
    where: { purchase_plan_id: { in: planIds } },
  });
  await prisma.stockLedger.deleteMany({
    where: { source_id: { in: planIds }, source_type: 'purchase_in' },
  });
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { target_id: { in: planIds } },
        { target_id: { in: batchIds } },
      ],
    },
  });
  await prisma.adminCommandReceipt.deleteMany({
    where: { admin_user_id: ids.admin },
  });
  await prisma.purchasePlanItem.deleteMany({
    where: { purchase_plan_id: { in: planIds } },
  });
  await prisma.purchasePlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.product.deleteMany({
    where: { id: { in: [ids.productA, ids.productB] } },
  });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
  await prisma.$disconnect();
});

describe.sequential('purchase receive ownership on PostgreSQL', () => {
  it('supports partial then full receipt and exact replay', async () => {
    const plan = await createPlan('partial-full', [
      { product_id: ids.productA, planned_quantity: 10 },
    ]);
    const partialInput = receiveInput(plan, 'partial', [4]);
    const partial = await executeAdminPurchaseReceiveCommand(partialInput);
    const replay = await executeAdminPurchaseReceiveCommand(partialInput);
    expect(partial.status).toBe('ordered');
    expect(replay).toEqual(partial);
    await expect(counts(plan.id)).resolves.toEqual({
      stock: 1,
      batches: 1,
      batchLedgers: 1,
      audits: 2,
      receipts: 1,
    });

    const full = await executeAdminPurchaseReceiveCommand(
      receiveInput(plan, 'full', [6]),
    );
    expect(full.status).toBe('received');
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: ids.productA } }),
    ).resolves.toMatchObject({ stock: 10 });
  });

  it('serializes different commands so cumulative receipt cannot overflow', async () => {
    const plan = await createPlan('same-plan-concurrent', [
      { product_id: ids.productA, planned_quantity: 5 },
    ]);
    const settled = await Promise.allSettled([
      executeAdminPurchaseReceiveCommand(
        receiveInput(plan, 'concurrent-a', [4]),
      ),
      executeAdminPurchaseReceiveCommand(
        receiveInput(plan, 'concurrent-b', [4]),
      ),
    ]);

    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    await expect(
      prisma.purchasePlanItem.findUniqueOrThrow({
        where: { id: plan.items[0].id },
      }),
    ).resolves.toMatchObject({ received_quantity: 4 });
  });

  it('keeps cross-plan same-product ledgers continuous', async () => {
    const before = await prisma.product.findUniqueOrThrow({
      where: { id: ids.productB },
    });
    const firstPlan = await createPlan('same-product-a', [
      { product_id: ids.productB, planned_quantity: 2 },
    ]);
    const secondPlan = await createPlan('same-product-b', [
      { product_id: ids.productB, planned_quantity: 3 },
    ]);
    await Promise.all([
      executeAdminPurchaseReceiveCommand(
        receiveInput(firstPlan, 'same-product-a', [2]),
      ),
      executeAdminPurchaseReceiveCommand(
        receiveInput(secondPlan, 'same-product-b', [3]),
      ),
    ]);
    const ledgers = await prisma.stockLedger.findMany({
      where: {
        product_id: ids.productB,
        source_id: { in: [firstPlan.id, secondPlan.id] },
        source_type: 'purchase_in',
      },
      orderBy: { stock_before: 'asc' },
    });
    expect(ledgers).toHaveLength(2);
    expect(ledgers[0].stock_before).toBe(before.stock);
    expect(ledgers[0].stock_after).toBe(ledgers[1].stock_before);
    expect(ledgers[1].stock_after).toBe(before.stock + 5);
  });

  it('allows only one of cancel and receive to commit from confirmed', async () => {
    const plan = await createPlan('cancel-race', [
      { product_id: ids.productA, planned_quantity: 1 },
    ]);
    const settled = await Promise.allSettled([
      cancelPurchasePlan({
        id: plan.id,
        admin: { admin_user_id: ids.admin },
      }),
      executeAdminPurchaseReceiveCommand(
        receiveInput(plan, 'cancel-race', [1]),
      ),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    const current = await prisma.purchasePlan.findUniqueOrThrow({
      where: { id: plan.id },
      include: { items: true },
    });
    expect(
      (current.status === 'cancelled' &&
        current.items[0].received_quantity === 0) ||
        (current.status === 'received' &&
          current.items[0].received_quantity === 1),
    ).toBe(true);
  });

  it('rolls back every domain and receipt when required audit fails', async () => {
    const plan = await createPlan('rollback', [
      { product_id: ids.productA, planned_quantity: 2 },
    ]);
    const productBefore = await prisma.product.findUniqueOrThrow({
      where: { id: ids.productA },
    });
    const removeTrigger = await installAuditFailure();
    try {
      await expect(
        executeAdminPurchaseReceiveCommand(
          receiveInput(plan, 'rollback', [2]),
        ),
      ).rejects.toMatchObject({
        statusCode: 500,
        code: 'ADMIN_PURCHASE_RECEIVE_FAILED',
      });
    } finally {
      await removeTrigger();
    }
    await expect(counts(plan.id)).resolves.toEqual({
      stock: 0,
      batches: 0,
      batchLedgers: 0,
      audits: 0,
      receipts: 0,
    });
    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: ids.productA } }),
    ).resolves.toMatchObject({ stock: productBefore.stock });
    await expect(
      prisma.purchasePlanItem.findUniqueOrThrow({
        where: { id: plan.items[0].id },
      }),
    ).resolves.toMatchObject({ received_quantity: 0 });
  });
});
