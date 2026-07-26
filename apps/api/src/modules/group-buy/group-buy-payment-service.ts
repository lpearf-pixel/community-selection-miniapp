import type { Prisma } from '@prisma/client';
import { recordBusinessEvent } from '../../services/logging-service.js';

export type GroupBuyPaymentProgress = {
  group_buy_id: string;
  status: string;
  paid_quantity: number;
  paid_people: number;
  target_count: number;
  is_success: boolean;
  became_success: boolean;
};

export async function refreshGroupBuyAfterPayment(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
  now: Date,
): Promise<GroupBuyPaymentProgress | null> {
  await tx.$queryRaw`
    SELECT id FROM "GroupBuy" WHERE id = ${groupBuyId} FOR UPDATE
  `;
  const groupBuy = await tx.groupBuy.findUnique({
    where: { id: groupBuyId },
  });
  if (!groupBuy) return null;

  const stable = (
    isSuccess: boolean,
  ): GroupBuyPaymentProgress => ({
    group_buy_id: groupBuy.id,
    status: groupBuy.status,
    paid_quantity: groupBuy.current_quantity,
    paid_people: groupBuy.current_people,
    target_count: groupBuy.min_quantity,
    is_success: isSuccess,
    became_success: false,
  });

  if (groupBuy.status === 'success') return stable(true);
  if (
    groupBuy.status !== 'pending'
    || groupBuy.end_time.getTime() <= now.getTime()
  ) {
    return stable(false);
  }

  const paidOrderWhere: Prisma.OrderWhereInput = {
    group_buy_id: groupBuyId,
    pay_status: 'paid',
    order_status: { notIn: ['closed', 'refunded'] },
    refund_status: { notIn: ['success'] },
  };
  const [quantity, paidPeople] = await Promise.all([
    tx.order.aggregate({
      where: paidOrderWhere,
      _sum: { quantity: true },
    }),
    tx.order.count({ where: paidOrderWhere }),
  ]);
  const paidQuantity = quantity._sum.quantity ?? 0;
  const isSuccess = paidQuantity >= groupBuy.min_quantity;
  const status = isSuccess ? 'success' : 'pending';

  await tx.groupBuy.update({
    where: { id: groupBuy.id },
    data: {
      ...(isSuccess ? { status: 'success' as const } : {}),
      current_quantity: paidQuantity,
      current_people: paidPeople,
    },
  });

  if (isSuccess) {
    await recordBusinessEvent(tx, {
      event_type: 'group_buy_success_refreshed',
      event_source: 'group-buy-payment-service',
      group_buy_id: groupBuy.id,
      payload: {
        paid_quantity: paidQuantity,
        paid_people: paidPeople,
        target_count: groupBuy.min_quantity,
        status: 'success',
      },
    });
  }

  return {
    group_buy_id: groupBuy.id,
    status,
    paid_quantity: paidQuantity,
    paid_people: paidPeople,
    target_count: groupBuy.min_quantity,
    is_success: isSuccess,
    became_success: isSuccess,
  };
}
