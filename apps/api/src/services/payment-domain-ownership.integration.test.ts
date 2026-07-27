import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { prisma } from '../db.js';
import { markOrderPaid } from './payment-service.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  category: `l50c3-category-${suffix}`,
  product: `l50c3-product-${suffix}`,
  community: `l50c3-community-${suffix}`,
  store: `l50c3-store-${suffix}`,
  leader: `l50c3-leader-${suffix}`,
  buyer1: `l50c3-buyer-1-${suffix}`,
  buyer2: `l50c3-buyer-2-${suffix}`,
};
const orderIds: string[] = [];
const groupBuyIds: string[] = [];

function orderId(label: string) {
  const id = `l50c3-order-${label}-${suffix}`;
  orderIds.push(id);
  return id;
}

function groupBuyId(label: string) {
  const id = `l50c3-group-${label}-${suffix}`;
  groupBuyIds.push(id);
  return id;
}

async function resetProductStock(stock: number) {
  await prisma.product.update({
    where: { id: ids.product },
    data: { stock },
  });
}

async function createNormalOrder(label: string, quantity: number) {
  const id = orderId(label);
  const order = await prisma.order.create({
    data: {
      id,
      order_no: `L50C3-N-${label}-${suffix}`,
      client_request_id: `l50c3-normal-${label}-${suffix}`,
      user_id: ids.buyer1,
      product_id: ids.product,
      total_amount_cents: 1000 * quantity,
      product_amount_cents: 1000 * quantity,
      pay_amount_cents: 1000 * quantity,
      quantity,
      receiver_name: '普通购买用户',
      receiver_phone: '13800000001',
      pickup_type: 'store',
      pickup_store_id: ids.store,
      community_id: ids.community,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      order_id: order.id,
      out_trade_no: `L50C3-PAY-N-${label}-${suffix}`,
      amount_cents: order.pay_amount_cents,
      trade_state: 'created',
    },
  });
  return { order, payment };
}

async function createGroup(label: string, minQuantity = 3) {
  return prisma.groupBuy.create({
    data: {
      id: groupBuyId(label),
      product_id: ids.product,
      leader_user_id: ids.leader,
      community_id: ids.community,
      min_people: 2,
      min_quantity: minQuantity,
      price_cents: 1000,
      start_time: new Date(Date.now() - 60_000),
      end_time: new Date(Date.now() + 86_400_000),
      pickup_time: new Date(Date.now() + 172_800_000),
    },
  });
}

async function createGroupOrder(
  groupId: string,
  label: string,
  userId: string,
  quantity: number,
) {
  const id = orderId(label);
  const order = await prisma.order.create({
    data: {
      id,
      order_no: `L50C3-G-${label}-${suffix}`,
      client_request_id: `l50c3-group-${label}-${suffix}`,
      user_id: userId,
      group_buy_id: groupId,
      leader_user_id: ids.leader,
      total_amount_cents: 1000 * quantity,
      product_amount_cents: 1000 * quantity,
      pay_amount_cents: 1000 * quantity,
      quantity,
      receiver_name: '拼团用户',
      receiver_phone: userId === ids.buyer1
        ? '13800000001'
        : '13800000002',
      pickup_type: 'store',
      pickup_store_id: ids.store,
      community_id: ids.community,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      order_id: order.id,
      out_trade_no: `L50C3-PAY-G-${label}-${suffix}`,
      amount_cents: order.pay_amount_cents,
      trade_state: 'created',
    },
  });
  return { order, payment };
}

async function pay(
  order: { id: string },
  payment: { id: string; out_trade_no: string },
) {
  return markOrderPaid(order.id, {
    payment_id: payment.id,
    out_trade_no: payment.out_trade_no,
    transaction_id: `L50C3-TXN-${payment.id}`,
    provider_success_at: new Date(),
  });
}

async function countsForOrder(id: string) {
  const [stock, timeline, commission, audit] = await Promise.all([
    prisma.stockLedger.count({
      where: {
        order_id: id,
        event_type: 'order_paid_deduct',
      },
    }),
    prisma.orderTimelineLog.count({
      where: {
        order_id: id,
        event_type: 'payment_mark_order_paid',
      },
    }),
    prisma.commission.count({ where: { order_id: id } }),
    prisma.auditLog.count({
      where: {
        target_id: id,
        action: 'payment_mark_order_paid',
      },
    }),
  ]);
  return { stock, timeline, commission, audit };
}

beforeAll(async () => {
  await prisma.category.create({
    data: { id: ids.category, name: ids.category },
  });
  await prisma.product.create({
    data: {
      id: ids.product,
      name: ids.product,
      category_id: ids.category,
      price_cents: 1000,
      cost_price_cents: 600,
      stock: 100,
      unit: '份',
      stock_unit: '份',
      stock_deduct_quantity: 1,
      is_group_enabled: true,
      commission_type: 'fixed',
      commission_value: 100,
      status: 'active',
    },
  });
  await prisma.community.create({
    data: {
      id: ids.community,
      name: ids.community,
      address: 'L50-C3 integration community',
    },
  });
  await prisma.pickupStore.create({
    data: {
      id: ids.store,
      name: ids.store,
      address: 'L50-C3 integration store',
      phone: '02500000000',
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: ids.leader,
        openid: `openid-${ids.leader}`,
        nickname: 'L50-C3 leader',
        role: 'leader',
      },
      {
        id: ids.buyer1,
        openid: `openid-${ids.buyer1}`,
        nickname: 'L50-C3 buyer 1',
      },
      {
        id: ids.buyer2,
        openid: `openid-${ids.buyer2}`,
        nickname: 'L50-C3 buyer 2',
      },
    ],
  });
});

afterAll(async () => {
  if (orderIds.length > 0) {
    await prisma.rewardLedger.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.commission.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.stockLedger.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.refund.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.payment.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.afterSaleCase.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.businessEventLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.orderTimelineLog.deleteMany({
      where: { order_id: { in: orderIds } },
    });
    await prisma.auditLog.deleteMany({
      where: { target_id: { in: orderIds } },
    });
  }
  if (groupBuyIds.length > 0) {
    await prisma.businessEventLog.deleteMany({
      where: { group_buy_id: { in: groupBuyIds } },
    });
    await prisma.groupBuy.deleteMany({
      where: { id: { in: groupBuyIds } },
    });
  }
  await prisma.product.deleteMany({ where: { id: ids.product } });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.pickupStore.deleteMany({ where: { id: ids.store } });
  await prisma.community.deleteMany({ where: { id: ids.community } });
  await prisma.user.deleteMany({
    where: { id: { in: [ids.leader, ids.buyer1, ids.buyer2] } },
  });
  await prisma.$disconnect();
});

describe.sequential('payment domain ownership on PostgreSQL', () => {
  it('pays a normal order and deducts inventory exactly once', async () => {
    await resetProductStock(10);
    const fixture = await createNormalOrder('normal', 2);

    const result = await pay(fixture.order, fixture.payment);
    const [product, storedOrder, storedPayment, counts] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: ids.product } }),
      prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } }),
      prisma.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
      }),
      countsForOrder(fixture.order.id),
    ]);

    expect(result.order).toMatchObject({
      id: fixture.order.id,
      pay_status: 'paid',
      order_status: 'paid',
    });
    expect(product.stock).toBe(8);
    expect(storedOrder).toMatchObject({
      pay_status: 'paid',
      order_status: 'paid',
    });
    expect(storedPayment).toMatchObject({
      trade_state: 'paid',
      transaction_id: `L50C3-TXN-${fixture.payment.id}`,
    });
    expect(counts).toEqual({
      stock: 1,
      timeline: 1,
      commission: 0,
      audit: 0,
    });
  });

  it('keeps a below-target group pending and the paid order paid', async () => {
    await resetProductStock(10);
    const group = await createGroup('below-target');
    const fixture = await createGroupOrder(
      group.id,
      'below-target',
      ids.buyer1,
      1,
    );

    await pay(fixture.order, fixture.payment);

    await expect(
      prisma.groupBuy.findUniqueOrThrow({ where: { id: group.id } }),
    ).resolves.toMatchObject({
      status: 'pending',
      current_quantity: 1,
      current_people: 1,
    });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } }),
    ).resolves.toMatchObject({
      pay_status: 'paid',
      order_status: 'paid',
    });
    expect(await countsForOrder(fixture.order.id)).toEqual({
      stock: 1,
      timeline: 1,
      commission: 1,
      audit: 1,
    });
  });

  it('groups every valid paid order when the last order reaches target', async () => {
    await resetProductStock(10);
    const group = await createGroup('sequential-target');
    const first = await createGroupOrder(
      group.id,
      'sequential-first',
      ids.buyer1,
      1,
    );
    const last = await createGroupOrder(
      group.id,
      'sequential-last',
      ids.buyer2,
      2,
    );

    await pay(first.order, first.payment);
    await pay(last.order, last.payment);

    await expect(
      prisma.groupBuy.findUniqueOrThrow({ where: { id: group.id } }),
    ).resolves.toMatchObject({
      status: 'success',
      current_quantity: 3,
      current_people: 2,
    });
    const orders = await prisma.order.findMany({
      where: { id: { in: [first.order.id, last.order.id] } },
      orderBy: { id: 'asc' },
    });
    expect(orders).toHaveLength(2);
    expect(orders.every((item) => item.order_status === 'grouped')).toBe(true);
  });

  it('serializes duplicate concurrent payment without duplicate side effects', async () => {
    await resetProductStock(10);
    const group = await createGroup('duplicate', 1);
    const fixture = await createGroupOrder(
      group.id,
      'duplicate',
      ids.buyer1,
      1,
    );

    await Promise.all([
      pay(fixture.order, fixture.payment),
      pay(fixture.order, fixture.payment),
    ]);

    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: ids.product } }),
    ).resolves.toMatchObject({ stock: 9 });
    expect(await countsForOrder(fixture.order.id)).toEqual({
      stock: 1,
      timeline: 1,
      commission: 1,
      audit: 1,
    });
  });

  it('serializes different concurrent payments that together reach target', async () => {
    await resetProductStock(10);
    const group = await createGroup('concurrent-target', 2);
    const first = await createGroupOrder(
      group.id,
      'concurrent-first',
      ids.buyer1,
      1,
    );
    const second = await createGroupOrder(
      group.id,
      'concurrent-second',
      ids.buyer2,
      1,
    );

    await Promise.all([
      pay(first.order, first.payment),
      pay(second.order, second.payment),
    ]);

    await expect(
      prisma.groupBuy.findUniqueOrThrow({ where: { id: group.id } }),
    ).resolves.toMatchObject({
      status: 'success',
      current_quantity: 2,
      current_people: 2,
    });
    const orders = await prisma.order.findMany({
      where: { id: { in: [first.order.id, second.order.id] } },
    });
    expect(orders).toHaveLength(2);
    expect(orders.every((item) => item.order_status === 'grouped')).toBe(true);
  });

  it('rolls back every payment domain when inventory is insufficient', async () => {
    await resetProductStock(1);
    const group = await createGroup('insufficient', 1);
    const fixture = await createGroupOrder(
      group.id,
      'insufficient',
      ids.buyer1,
      2,
    );

    await expect(
      pay(fixture.order, fixture.payment),
    ).rejects.toThrowError('库存不足');

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } }),
    ).resolves.toMatchObject({
      pay_status: 'unpaid',
      order_status: 'unpaid',
    });
    await expect(
      prisma.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
      }),
    ).resolves.toMatchObject({ trade_state: 'created' });
    await expect(
      prisma.groupBuy.findUniqueOrThrow({ where: { id: group.id } }),
    ).resolves.toMatchObject({
      status: 'pending',
      current_quantity: 0,
      current_people: 0,
    });
    expect(await countsForOrder(fixture.order.id)).toEqual({
      stock: 0,
      timeline: 0,
      commission: 0,
      audit: 0,
    });
  });

  it('rolls back inventory, order, group, reward, and logs when audit fails', async () => {
    await resetProductStock(10);
    const group = await createGroup('audit-rollback', 1);
    const fixture = await createGroupOrder(
      group.id,
      'audit-rollback',
      ids.buyer1,
      1,
    );
    const functionName = `l50c3_fail_audit_${suffix.replace(/[^a-z0-9]/gi, '_')}`;
    const triggerName = `l50c3_fail_audit_trigger_${suffix.replace(/[^a-z0-9]/gi, '_')}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $l50c3$
      BEGIN
        IF NEW.action = 'payment_mark_order_paid'
          AND NEW.target_id = '${fixture.order.id}' THEN
          RAISE EXCEPTION 'forced L50-C3 audit failure';
        END IF;
        RETURN NEW;
      END;
      $l50c3$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);

    try {
      await expect(
        pay(fixture.order, fixture.payment),
      ).rejects.toThrowError('forced L50-C3 audit failure');
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON "AuditLog"`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${functionName}()`,
      );
    }

    await expect(
      prisma.product.findUniqueOrThrow({ where: { id: ids.product } }),
    ).resolves.toMatchObject({ stock: 10 });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } }),
    ).resolves.toMatchObject({
      pay_status: 'unpaid',
      order_status: 'unpaid',
    });
    await expect(
      prisma.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
      }),
    ).resolves.toMatchObject({ trade_state: 'created' });
    await expect(
      prisma.groupBuy.findUniqueOrThrow({ where: { id: group.id } }),
    ).resolves.toMatchObject({
      status: 'pending',
      current_quantity: 0,
      current_people: 0,
    });
    expect(await countsForOrder(fixture.order.id)).toEqual({
      stock: 0,
      timeline: 0,
      commission: 0,
      audit: 0,
    });
  });
});
