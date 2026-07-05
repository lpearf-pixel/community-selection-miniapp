import { OrderStatus, PayStatus, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

export type OperationsQuery = {
  from?: string;
  to?: string;
  community_id?: string;
  pickup_store_id?: string;
  days?: number;
  sort_by?: string;
  limit?: number;
  type?: string;
};

type OperationsAlert = {
  type: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  metric_value: number;
  related_id?: string;
  related_type?: string;
};

type ProductRow = {
  product_id: string;
  product_name: string;
  category_name: string;
  order_count: number;
  quantity_sold: number;
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  after_sale_case_count: number;
  after_sale_rate: number;
  inventory_loss_count: number;
};

type CommunityRow = {
  community_id: string;
  community_name: string;
  order_count: number;
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  pickup_completed_count: number;
  after_sale_case_count: number;
  active_group_buy_count: number;
};

type PickupStoreRow = {
  pickup_store_id: string;
  pickup_store_name: string;
  order_count: number;
  pickup_completed_count: number;
  pickup_pending_count: number;
  pickup_completion_rate: number;
  paid_amount: number;
  after_sale_case_count: number;
};

export function numberOrZero(value: number | null | undefined): number {
  return value ?? 0;
}

export function sumOrZero(value: number | null | undefined): number {
  return numberOrZero(value);
}

function rate(numerator: number | null | undefined, denominator: number | null | undefined): number {
  const n = numberOrZero(numerator);
  const d = numberOrZero(denominator);
  return d > 0 ? n / d : 0;
}

function dateWhere(query: Pick<OperationsQuery, 'from' | 'to'>): Prisma.DateTimeFilter | undefined {
  const where: Prisma.DateTimeFilter = {};
  if (query.from) where.gte = new Date(query.from);
  if (query.to) where.lte = new Date(query.to);
  return Object.keys(where).length ? where : undefined;
}

function orderWhere(query: OperationsQuery): Prisma.OrderWhereInput {
  return {
    created_at: dateWhere(query),
    community_id: query.community_id,
    pickup_store_id: query.pickup_store_id
  };
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + numberOrZero(value), 0);
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function scopedOrders(query: OperationsQuery) {
  return prisma.order.findMany({
    where: orderWhere(query),
    include: {
      after_sale_cases: true,
      commissions: true,
      group_buy: {
        include: {
          product: { include: { category: true } },
          community: true
        }
      },
      community: true,
      pickup_store: true
    }
  });
}

export async function getOperationsOverview(query: OperationsQuery) {
  const orders = await scopedOrders(query);
  const paidOrders = orders.filter((order) => order.pay_status === 'paid');
  const [inventoryLosses, activeGroupBuyCount, activeProductCount, activeCommunityCount] = await Promise.all([
    prisma.inventoryLoss.findMany({ where: { created_at: dateWhere(query) }, include: { product: true } }),
    prisma.groupBuy.count({ where: { status: { in: ['pending', 'success', 'preparing', 'ready'] }, community_id: query.community_id } }),
    prisma.product.count({ where: { status: 'active' } }),
    prisma.community.count({ where: { status: 'active' } })
  ]);

  const afterSaleCaseCount = sum(orders.map((order) => order.after_sale_cases.length));
  const paidAmount = sum(paidOrders.map((order) => order.pay_amount_cents));
  const refundedAmount = sum(orders.map((order) => order.refund_amount_cents));
  const pickupCompletedCount = sum(orders.map((order) => (['picked', 'completed'].includes(order.order_status) ? 1 : 0)));
  const pickupPendingCount = sum(orders.map((order) => (order.order_status === 'ready' ? 1 : 0)));
  const inventoryLossCount = numberOrZero(inventoryLosses.length);
  const inventoryLossEstimatedAmount = sum(
    inventoryLosses.map((loss) => numberOrZero(loss.quantity) * numberOrZero(loss.product.cost_price_cents))
  );

  return {
    order_count: numberOrZero(orders.length),
    paid_order_count: numberOrZero(paidOrders.length),
    completed_order_count: sum(orders.map((order) => (order.order_status === 'completed' ? 1 : 0))),
    cancelled_order_count: sum(orders.map((order) => (['closed', 'refunded'].includes(order.order_status) ? 1 : 0))),
    gross_sales_amount: sum(orders.map((order) => order.total_amount_cents)),
    paid_amount: paidAmount,
    refunded_amount: refundedAmount,
    net_sales_amount: paidAmount - refundedAmount,
    after_sale_case_count: afterSaleCaseCount,
    after_sale_rate: rate(afterSaleCaseCount, paidOrders.length),
    refund_rate: rate(refundedAmount, paidAmount),
    pickup_completed_count: pickupCompletedCount,
    pickup_pending_count: pickupPendingCount,
    inventory_loss_count: inventoryLossCount,
    inventory_loss_estimated_amount: inventoryLossEstimatedAmount,
    service_reward_amount: sum(orders.flatMap((order) => order.commissions.map((item) => item.final_amount_cents))),
    active_group_buy_count: numberOrZero(activeGroupBuyCount),
    active_product_count: numberOrZero(activeProductCount),
    active_community_count: numberOrZero(activeCommunityCount)
  };
}

export async function getOperationsTrends(query: OperationsQuery) {
  const days = Math.min(31, Math.max(1, numberOrZero(query.days ?? 7)));
  const today = startOfDay(new Date());
  const from = addDays(today, -(days - 1));
  const to = addDays(today, 1);
  const orders = await scopedOrders({ ...query, from: from.toISOString(), to: to.toISOString() });
  const losses = await prisma.inventoryLoss.findMany({ where: { created_at: { gte: from, lt: to } } });

  return Array.from({ length: days }, (_, index) => dayKey(addDays(from, index))).map((date) => {
    const dayOrders = orders.filter((order) => dayKey(order.created_at) === date);
    const paidOrders = dayOrders.filter((order) => order.pay_status === 'paid');
    const paidAmount = sum(paidOrders.map((order) => order.pay_amount_cents));
    const refundedAmount = sum(dayOrders.map((order) => order.refund_amount_cents));
    const pickupCompletedCount = sum(dayOrders.map((order) => (['picked', 'completed'].includes(order.order_status) ? 1 : 0)));

    return {
      date,
      order_count: numberOrZero(dayOrders.length),
      paid_amount: paidAmount,
      refunded_amount: refundedAmount,
      net_sales_amount: paidAmount - refundedAmount,
      after_sale_case_count: sum(dayOrders.map((order) => order.after_sale_cases.length)),
      inventory_loss_count: numberOrZero(losses.filter((loss) => dayKey(loss.created_at) === date).length),
      pickup_completed_count: pickupCompletedCount
    };
  });
}

export async function getOperationsProducts(query: OperationsQuery) {
  const validOrderStatuses = [
    OrderStatus.paid,
    OrderStatus.grouped,
    OrderStatus.preparing,
    OrderStatus.ready,
    OrderStatus.picked,
    OrderStatus.delivered,
    OrderStatus.completed,
    OrderStatus.refunding,
    OrderStatus.refunded
  ];
  const orders = await prisma.order.findMany({
    where: {
      ...orderWhere(query),
      pay_status: PayStatus.paid,
      order_status: { in: validOrderStatuses },
      group_buy_id: { not: null }
    },
    include: {
      after_sale_cases: true,
      group_buy: { include: { product: { include: { category: true } } } }
    }
  });
  const losses = await prisma.inventoryLoss.findMany({ where: { created_at: dateWhere(query) } });
  const rows = new Map<string, ProductRow>();

  for (const order of orders) {
    const product = order.group_buy?.product;
    if (!product) continue;

    const row = rows.get(product.id) ?? {
      product_id: product.id,
      product_name: product.name,
      category_name: product.category.name,
      order_count: 0,
      quantity_sold: 0,
      paid_amount: 0,
      refunded_amount: 0,
      net_sales_amount: 0,
      after_sale_case_count: 0,
      after_sale_rate: 0,
      inventory_loss_count: 0
    };

    row.order_count += 1;
    row.quantity_sold += numberOrZero(order.quantity);
    row.paid_amount += order.pay_status === 'paid' ? numberOrZero(order.pay_amount_cents) : 0;
    row.refunded_amount += numberOrZero(order.refund_amount_cents);
    row.after_sale_case_count += numberOrZero(order.after_sale_cases.length);
    rows.set(product.id, row);
  }

  for (const row of rows.values()) {
    row.net_sales_amount = numberOrZero(row.paid_amount) - numberOrZero(row.refunded_amount);
    row.after_sale_rate = rate(row.after_sale_case_count, row.order_count);
    row.inventory_loss_count = numberOrZero(losses.filter((loss) => loss.product_id === row.product_id).length);
  }

  const sort = query.sort_by ?? 'sales_amount';
  const key: keyof Pick<ProductRow, 'refunded_amount' | 'after_sale_case_count' | 'order_count' | 'paid_amount'> =
    sort === 'refund_amount'
      ? 'refunded_amount'
      : sort === 'after_sale_count'
        ? 'after_sale_case_count'
        : sort === 'order_count'
          ? 'order_count'
          : 'paid_amount';

  return [...rows.values()]
    .sort((a, b) => numberOrZero(b[key]) - numberOrZero(a[key]))
    .slice(0, Math.min(100, Math.max(1, numberOrZero(query.limit ?? 20))));
}

export async function getOperationsCommunities(query: OperationsQuery) {
  const orders = await scopedOrders(query);
  const rows = new Map<string, CommunityRow>();

  for (const order of orders) {
    const community = order.community ?? order.group_buy?.community;
    if (!community) continue;

    const row = rows.get(community.id) ?? {
      community_id: community.id,
      community_name: community.name,
      order_count: 0,
      paid_amount: 0,
      refunded_amount: 0,
      net_sales_amount: 0,
      pickup_completed_count: 0,
      after_sale_case_count: 0,
      active_group_buy_count: 0
    };

    row.order_count += 1;
    row.paid_amount += order.pay_status === 'paid' ? numberOrZero(order.pay_amount_cents) : 0;
    row.refunded_amount += numberOrZero(order.refund_amount_cents);
    row.pickup_completed_count += ['picked', 'completed'].includes(order.order_status) ? 1 : 0;
    row.after_sale_case_count += numberOrZero(order.after_sale_cases.length);
    rows.set(community.id, row);
  }

  for (const row of rows.values()) {
    row.net_sales_amount = numberOrZero(row.paid_amount) - numberOrZero(row.refunded_amount);
    row.active_group_buy_count = numberOrZero(
      await prisma.groupBuy.count({
        where: { community_id: row.community_id, status: { in: ['pending', 'success', 'preparing', 'ready'] } }
      })
    );
  }

  return [...rows.values()].sort((a, b) => numberOrZero(b.paid_amount) - numberOrZero(a.paid_amount));
}

export async function getOperationsPickupStores(query: OperationsQuery) {
  const orders = await scopedOrders(query);
  const rows = new Map<string, PickupStoreRow>();

  for (const order of orders) {
    const store = order.pickup_store;
    if (!store) continue;

    const row = rows.get(store.id) ?? {
      pickup_store_id: store.id,
      pickup_store_name: store.name,
      order_count: 0,
      pickup_completed_count: 0,
      pickup_pending_count: 0,
      pickup_completion_rate: 0,
      paid_amount: 0,
      after_sale_case_count: 0
    };

    row.order_count += 1;
    row.pickup_completed_count += ['picked', 'completed'].includes(order.order_status) ? 1 : 0;
    row.pickup_pending_count += order.order_status === 'ready' ? 1 : 0;
    row.paid_amount += order.pay_status === 'paid' ? numberOrZero(order.pay_amount_cents) : 0;
    row.after_sale_case_count += numberOrZero(order.after_sale_cases.length);
    rows.set(store.id, row);
  }

  for (const row of rows.values()) {
    row.pickup_completion_rate = rate(row.pickup_completed_count, row.order_count);
  }

  return [...rows.values()].sort((a, b) => numberOrZero(b.pickup_completed_count) - numberOrZero(a.pickup_completed_count));
}

export async function getOperationsAlerts(query: OperationsQuery): Promise<OperationsAlert[]> {
  const overview = await getOperationsOverview(query);
  const refundedAmount = numberOrZero(overview.refunded_amount);
  const refundRate = numberOrZero(overview.refund_rate);
  const inventoryLossCount = numberOrZero(overview.inventory_loss_count);
  const pickupPendingCount = numberOrZero(overview.pickup_pending_count);
  const activeProductCount = numberOrZero(overview.active_product_count);
  const alerts: OperationsAlert[] = [];
  const push = (
    type: OperationsAlert['type'],
    severity: OperationsAlert['severity'],
    title: string,
    description: string,
    metricValue: number | null | undefined
  ) => alerts.push({ type, severity, title, description, metric_value: numberOrZero(metricValue) });

  if (rate(overview.after_sale_case_count, overview.paid_order_count) > 0.2) {
    push('high_after_sale_rate', 'high', '售后率偏高', '请关注商品质量、履约和客服处理情况。', overview.after_sale_rate);
  }
  if (refundedAmount > 0) {
    push('high_refund_amount', refundRate > 0.2 ? 'high' : 'medium', '退款金额需关注', '请核对退款原因和售后记录。', refundedAmount);
  }
  if (inventoryLossCount > 0) {
    push('high_inventory_loss', 'medium', '存在库存损耗', '请复盘损耗商品、批次与责任记录。', inventoryLossCount);
  }
  if (pickupPendingCount > 10) {
    push('pickup_pending_too_many', 'medium', '待自提订单较多', '请提醒门店核对待自提订单。', pickupPendingCount);
  }
  if (activeProductCount < 3) {
    push('low_active_products', 'low', '在售商品较少', '请评估是否需要补充可售商品。', activeProductCount);
  }

  return alerts;
}

export function toOperationsCsv(rows: Array<Record<string, unknown>>) {
  const headers = Object.keys(rows[0] ?? { empty: '' });
  const esc = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return ['\uFEFF' + headers.join(','), ...rows.map((row) => headers.map((key) => esc(row[key])).join(','))].join('\n');
}
