import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import { prisma } from '../db.js';
import {
  createMockRefund,
  markRefundSuccess,
} from './refund-service.js';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids = {
  category: `l50c3-refund-category-${suffix}`,
  product: `l50c3-refund-product-${suffix}`,
  community: `l50c3-refund-community-${suffix}`,
  leader: `l50c3-refund-leader-${suffix}`,
  buyer: `l50c3-refund-buyer-${suffix}`,
};
const orderIds: string[] = [];
const groupIds: string[] = [];

async function createOrder(
  label: string,
  options: {
    pay_amount_cents?: number;
    product_amount_cents?: number;
    delivery_fee_cents?: number;
    credit_amount_cents?: number;
    with_commission?: boolean;
    deducted_quantity?: number;
  } = {},
) {
  const pay = options.pay_amount_cents ?? 1000;
  const product = options.product_amount_cents ?? pay;
  const delivery = options.delivery_fee_cents ?? pay - product;
  let groupId: string | null = null;
  if (options.with_commission) {
    groupId = `l50c3-refund-group-${label}-${suffix}`;
    groupIds.push(groupId);
    await prisma.groupBuy.create({
      data: {
        id: groupId,
        product_id: ids.product,
        leader_user_id: ids.leader,
        community_id: ids.community,
        min_people: 1,
        min_quantity: 1,
        price_cents: product,
        start_time: new Date(Date.now() - 60_000),
        end_time: new Date(Date.now() + 86_400_000),
        pickup_time: new Date(Date.now() + 172_800_000),
        status: 'success',
        current_people: 1,
        current_quantity: 1,
      },
    });
  }
  const id = `l50c3-refund-order-${label}-${suffix}`;
  orderIds.push(id);
  const order = await prisma.order.create({
    data: {
      id,
      order_no: `L50C3-R-${label}-${suffix}`,
      client_request_id: `l50c3-refund-${label}-${suffix}`,
      user_id: ids.buyer,
      group_buy_id: groupId,
      leader_user_id: groupId ? ids.leader : null,
      product_id: groupId ? null : ids.product,
      total_amount_cents: pay,
      product_amount_cents: product,
      delivery_fee_cents: delivery,
      pay_amount_cents: pay,
      quantity: 1,
      credit_amount_cents: options.credit_amount_cents ?? 0,
      credit_source_type: options.credit_amount_cents
        ? 'reward_conversion'
        : null,
      credit_source_id: options.credit_amount_cents
        ? `conversion-${label}`
        : null,
      pay_status: 'paid',
      order_status: groupId ? 'grouped' : 'paid',
      refund_status: 'none',
      pickup_type: 'store',
      community_id: ids.community,
      receiver_name: '退款集成用户',
      receiver_phone: '13800000000',
    },
  });
  if (options.deducted_quantity) {
    const current = await prisma.product.findUniqueOrThrow({
      where: { id: ids.product },
    });
    await prisma.product.update({
      where: { id: ids.product },
      data: { stock: { decrement: options.deducted_quantity } },
    });
    await prisma.stockLedger.create({
      data: {
        product_id: ids.product,
        source_type: 'order_payment',
        source_id: order.id,
        idempotency_key: `order-paid-deduct:${order.id}`,
        event_type: 'order_paid_deduct',
        quantity_delta: -options.deducted_quantity,
        order_id: order.id,
        direction: 'out',
        quantity: options.deducted_quantity,
        stock_before: current.stock,
        stock_after: current.stock - options.deducted_quantity,
      },
    });
  }
  if (groupId) {
    await prisma.commission.create({
      data: {
        leader_user_id: ids.leader,
        order_id: order.id,
        group_buy_id: groupId,
        base_amount_cents: product,
        commission_type: 'fixed',
        commission_value: 100,
        estimated_amount_cents: 100,
        final_amount_cents: 100,
        status: 'estimated',
      },
    });
  }
  if (options.credit_amount_cents) {
    await prisma.consumerCreditLedger.create({
      data: {
        user_id: ids.buyer,
        source_type: 'order_payment',
        source_id: order.id,
        direction: 'out',
        amount_cents: options.credit_amount_cents,
        balance_after_cents: 0,
        usable_scope: 'platform_order',
      },
    });
  }
  return order;
}

async function refundEffectCounts(orderId: string) {
  const refundIds = (
    await prisma.refund.findMany({
      where: { order_id: orderId },
      select: { id: true },
    })
  ).map((item) => item.id);
  const [stock, credit, timeline, audit, reward] = await Promise.all([
    prisma.stockLedger.count({
      where: { order_id: orderId, event_type: 'refund_success_restore' },
    }),
    prisma.consumerCreditLedger.count({
      where: { source_type: 'order_refund', source_id: orderId },
    }),
    prisma.orderTimelineLog.count({
      where: { order_id: orderId, event_type: 'refund_success' },
    }),
    prisma.auditLog.count({
      where: { target_id: { in: refundIds }, action: 'refund_success' },
    }),
    prisma.rewardLedger.count({ where: { order_id: orderId } }),
  ]);
  return { stock, credit, timeline, audit, reward };
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
      address: 'L50-C3 refund integration',
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: ids.leader,
        openid: `openid-${ids.leader}`,
        nickname: '退款集成开团人',
        role: 'leader',
      },
      {
        id: ids.buyer,
        openid: `openid-${ids.buyer}`,
        nickname: '退款集成用户',
      },
    ],
  });
});

afterAll(async () => {
  const refunds = await prisma.refund.findMany({
    where: { order_id: { in: orderIds } },
    select: { id: true },
  });
  const refundIds = refunds.map((item) => item.id);
  await prisma.rewardLedger.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.commission.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.consumerCreditLedger.deleteMany({
    where: {
      OR: [
        { source_id: { in: orderIds } },
        { user_id: ids.buyer, source_type: 'order_refund' },
      ],
    },
  });
  await prisma.stockLedger.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.businessEventLog.deleteMany({
    where: { order_id: { in: orderIds } },
  });
  await prisma.orderTimelineLog.deleteMany({
    where: { order_id: { in: orderIds } },
  });
  await prisma.auditLog.deleteMany({ where: { target_id: { in: refundIds } } });
  await prisma.refund.deleteMany({ where: { order_id: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.groupBuy.deleteMany({ where: { id: { in: groupIds } } });
  await prisma.product.deleteMany({ where: { id: ids.product } });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.community.deleteMany({ where: { id: ids.community } });
  await prisma.user.deleteMany({
    where: { id: { in: [ids.leader, ids.buyer] } },
  });
  await prisma.$disconnect();
});

describe.sequential('refund domain ownership on PostgreSQL', () => {
  it('keeps partial effects narrow and applies full effects exactly once', async () => {
    const order = await createOrder('partial-full', {
      product_amount_cents: 800,
      delivery_fee_cents: 200,
      credit_amount_cents: 300,
      with_commission: true,
      deducted_quantity: 2,
    });
    await createMockRefund({
      order_id: order.id,
      refund_amount_cents: 500,
      product_refund_amount_cents: 400,
      delivery_refund_amount_cents: 100,
      reason: '第一次部分退款',
      client_refund_id: `partial-1-${suffix}`,
    });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      refund_amount_cents: 500,
      order_status: 'grouped',
    });
    await expect(refundEffectCounts(order.id)).resolves.toMatchObject({
      stock: 0,
      credit: 0,
      timeline: 1,
      audit: 1,
    });
    await expect(
      prisma.commission.findFirstOrThrow({ where: { order_id: order.id } }),
    ).resolves.toMatchObject({ final_amount_cents: 50, status: 'estimated' });

    const fullInput = {
      order_id: order.id,
      refund_amount_cents: 500,
      product_refund_amount_cents: 400,
      delivery_refund_amount_cents: 100,
      reason: '累计全额退款',
      client_refund_id: `partial-2-${suffix}`,
    };
    await createMockRefund(fullInput);
    await createMockRefund(fullInput);

    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      refund_amount_cents: 1000,
      product_refund_amount_cents: 800,
      delivery_refund_amount_cents: 200,
      order_status: 'refunded',
    });
    await expect(refundEffectCounts(order.id)).resolves.toMatchObject({
      stock: 1,
      credit: 1,
      timeline: 2,
      audit: 2,
    });
    await expect(
      prisma.commission.findFirstOrThrow({ where: { order_id: order.id } }),
    ).resolves.toMatchObject({ final_amount_cents: 0, status: 'cancelled' });
  });

  it('serializes distinct concurrent refunds against the latest balance', async () => {
    const order = await createOrder('concurrent-over-refund');
    const settled = await Promise.allSettled([
      createMockRefund({
        order_id: order.id,
        refund_amount_cents: 700,
        product_refund_amount_cents: 700,
        delivery_refund_amount_cents: 0,
        reason: '并发退款 A',
        client_refund_id: `concurrent-a-${suffix}`,
      }),
      createMockRefund({
        order_id: order.id,
        refund_amount_cents: 700,
        product_refund_amount_cents: 700,
        delivery_refund_amount_cents: 0,
        reason: '并发退款 B',
        client_refund_id: `concurrent-b-${suffix}`,
      }),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({ refund_amount_cents: 700 });
    await expect(prisma.refund.count({
      where: { order_id: order.id, status: 'success' },
    })).resolves.toBe(1);
  });

  it('serializes a duplicate provider success without duplicate side effects', async () => {
    const order = await createOrder('duplicate-notify', {
      credit_amount_cents: 200,
      deducted_quantity: 1,
    });
    const refund = await prisma.refund.create({
      data: {
        order_id: order.id,
        out_refund_no: `RF-DUP-${suffix}`,
        refund_amount_cents: 1000,
        product_refund_amount_cents: 1000,
        delivery_refund_amount_cents: 0,
        reason: '重复通知',
        status: 'pending',
      },
    });
    await Promise.all([
      markRefundSuccess(refund.id, {
        refund_id: `WX-DUP-${suffix}`,
        out_refund_no: refund.out_refund_no,
      }),
      markRefundSuccess(refund.id, {
        refund_id: `WX-DUP-${suffix}`,
        out_refund_no: refund.out_refund_no,
      }),
    ]);
    await expect(refundEffectCounts(order.id)).resolves.toMatchObject({
      stock: 1,
      credit: 1,
      timeline: 1,
      audit: 1,
    });
  });

  it('rolls back refund, order, stock, credit, and logs when audit fails', async () => {
    const order = await createOrder('audit-rollback', {
      credit_amount_cents: 200,
      deducted_quantity: 1,
    });
    const refund = await prisma.refund.create({
      data: {
        order_id: order.id,
        out_refund_no: `RF-ROLLBACK-${suffix}`,
        refund_amount_cents: 1000,
        product_refund_amount_cents: 1000,
        delivery_refund_amount_cents: 0,
        reason: '回滚验证',
        status: 'pending',
      },
    });
    const safeSuffix = suffix.replace(/[^a-z0-9]/gi, '_');
    const functionName = `l50c3_refund_fail_audit_${safeSuffix}`;
    const triggerName = `l50c3_refund_fail_audit_trigger_${safeSuffix}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${functionName}() RETURNS trigger AS $l50c3$
      BEGIN
        IF NEW.action = 'refund_success'
          AND NEW.target_id = '${refund.id}' THEN
          RAISE EXCEPTION 'forced L50-C3 refund audit failure';
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
      await expect(markRefundSuccess(refund.id)).rejects.toThrowError(
        'forced L50-C3 refund audit failure',
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${triggerName} ON "AuditLog"`,
      );
      await prisma.$executeRawUnsafe(
        `DROP FUNCTION IF EXISTS ${functionName}()`,
      );
    }
    await expect(
      prisma.refund.findUniqueOrThrow({ where: { id: refund.id } }),
    ).resolves.toMatchObject({ status: 'pending', stock_restored: false });
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: order.id } }),
    ).resolves.toMatchObject({
      refund_amount_cents: 0,
      order_status: 'paid',
    });
    await expect(refundEffectCounts(order.id)).resolves.toMatchObject({
      stock: 0,
      credit: 0,
      timeline: 0,
      audit: 0,
    });
  });
});
