import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { deductInventoryForPaidOrder } from '../modules/inventory/inventory-order-service.js';
import { ensureEstimatedCommission } from './commission-service.js';
import { safeRecordBusinessEvent, safeRecordOrderTimeline } from './logging-service.js';


export async function refreshGroupBuySuccessState(tx: Prisma.TransactionClient, groupBuyId: string) {
  const groupBuy = await tx.groupBuy.findUnique({ where: { id: groupBuyId } });
  if (!groupBuy) return null;
  if (groupBuy.status === 'success') return { groupBuy, paid_quantity: groupBuy.current_quantity, is_success: true };
  if (groupBuy.status !== 'pending') return { groupBuy, paid_quantity: groupBuy.current_quantity, is_success: false };
  if (groupBuy.end_time.getTime() <= Date.now()) return { groupBuy, paid_quantity: groupBuy.current_quantity, is_success: false };

  const paidOrderWhere: Prisma.OrderWhereInput = {
    group_buy_id: groupBuyId,
    pay_status: 'paid',
    order_status: { notIn: ['closed', 'refunded'] },
    refund_status: { notIn: ['success'] }
  };
  const paidQuantityResult = await tx.order.aggregate({
    where: paidOrderWhere,
    _sum: { quantity: true }
  });
  const paidPeople = await tx.order.count({ where: paidOrderWhere });
  const paidQuantity = paidQuantityResult._sum.quantity ?? 0;
  const target_count = groupBuy.min_quantity;

  await tx.groupBuy.update({
    where: { id: groupBuyId },
    data: { current_quantity: paidQuantity, current_people: paidPeople }
  });

  if (paidQuantity < target_count) return { groupBuy, paid_quantity: paidQuantity, is_success: false };

  const updatedGroupBuy = await tx.groupBuy.update({
    where: { id: groupBuyId },
    data: { status: 'success', current_quantity: paidQuantity, current_people: paidPeople }
  });
  await tx.order.updateMany({
    where: { group_buy_id: groupBuyId, pay_status: 'paid', order_status: { notIn: ['closed', 'refunded'] } },
    data: { order_status: 'grouped' }
  });
  await safeRecordBusinessEvent(tx, {
    event_type: 'group_buy_success_refreshed',
    event_source: 'payment-service',
    group_buy_id: groupBuyId,
    payload: { paid_quantity: paidQuantity, paid_people: paidPeople, target_count, status: 'success' }
  });
  return { groupBuy: updatedGroupBuy, paid_quantity: paidQuantity, is_success: true };
}

type PaymentInfo = {
  payment_id?: string;
  out_trade_no?: string;
  transaction_id?: string;
  raw_notify?: Prisma.InputJsonValue;
};

export async function markOrderPaid(orderId: string, paymentInfo: PaymentInfo = {}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { group_buy: true, product: true }
    });
    if (!order) throw new Error('订单不存在');

    const payment = paymentInfo.payment_id
      ? await tx.payment.findUnique({ where: { id: paymentInfo.payment_id } })
      : paymentInfo.out_trade_no
        ? await tx.payment.findUnique({ where: { out_trade_no: paymentInfo.out_trade_no } })
        : await tx.payment.findFirst({ where: { order_id: order.id }, orderBy: { created_at: 'desc' } });

    if (order.pay_status === 'paid') {
      await safeRecordBusinessEvent(tx, {
        event_type: 'payment_duplicate_ignored',
        event_level: 'warning',
        event_source: 'payment-service',
        order_id: order.id,
        payment_id: payment?.id ?? null,
        payload: { out_trade_no: payment?.out_trade_no ?? paymentInfo.out_trade_no ?? null }
      });
      const paidPayment = payment
        ? await tx.payment.update({
          where: { id: payment.id },
          data: {
            trade_state: 'paid',
            transaction_id: payment.transaction_id ?? paymentInfo.transaction_id,
            ...(paymentInfo.raw_notify === undefined ? {} : { raw_notify: paymentInfo.raw_notify })
          }
        })
        : null;
      if (order.group_buy_id) await refreshGroupBuySuccessState(tx, order.group_buy_id);
      return { order, payment: paidPayment };
    }

    const groupBuy = order.group_buy;
    if (!groupBuy && !order.product_id) throw new Error('订单不可支付');
    if (!groupBuy) {
      await deductInventoryForPaidOrder(tx, { order, operator_user_id: order.user_id });
      const paidResult = await tx.order.updateMany({ where: { id: order.id, pay_status: 'unpaid' }, data: { pay_status: 'paid', paid_at: new Date(), order_status: 'paid' } });
      if (paidResult.count !== 1) {
        const latestOrder = await tx.order.findUnique({ where: { id: order.id }, include: { group_buy: true, product: true } });
        return { order: latestOrder, payment };
      }
      const paidPayment = payment ? await tx.payment.update({ where: { id: payment.id }, data: { trade_state: 'paid', transaction_id: payment.transaction_id ?? paymentInfo.transaction_id, ...(paymentInfo.raw_notify === undefined ? {} : { raw_notify: paymentInfo.raw_notify }) } }) : null;
      const paidOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { product: true } });
      await safeRecordBusinessEvent(tx, { event_type: 'payment_mark_normal_order_paid', event_source: 'payment-service', order_id: order.id, payment_id: paidPayment?.id ?? null, before_snapshot: order, after_snapshot: paidOrder, payload: { transaction_id: paidPayment?.transaction_id ?? paymentInfo.transaction_id ?? null, product_id: order.product_id } });
      await safeRecordOrderTimeline(tx, { order_id: order.id, event_type: 'payment_mark_order_paid', title: '订单已支付', from_status: order.order_status, to_status: paidOrder.order_status, actor_type: 'system', payload: { payment_id: paidPayment?.id ?? null } });
      return { order: paidOrder, payment: paidPayment };
    }
    if (groupBuy.status !== 'pending' && groupBuy.status !== 'success') throw new Error('当前团购不可支付');
    if (groupBuy.end_time.getTime() <= Date.now()) throw new Error('团购已截止');

    await deductInventoryForPaidOrder(tx, { order, operator_user_id: order.user_id });
    const paidResult = await tx.order.updateMany({
      where: { id: order.id, pay_status: 'unpaid' },
      data: { pay_status: 'paid', paid_at: new Date() }
    });
    if (paidResult.count !== 1) {
      const latestOrder = await tx.order.findUnique({ where: { id: order.id }, include: { group_buy: true, product: true } });
      return { order: latestOrder, payment };
    }

    const paidPayment = payment
      ? await tx.payment.update({
        where: { id: payment.id },
        data: {
          trade_state: 'paid',
          transaction_id: payment.transaction_id ?? paymentInfo.transaction_id,
          ...(paymentInfo.raw_notify === undefined ? {} : { raw_notify: paymentInfo.raw_notify })
        }
      })
      : null;

    const refreshedGroupBuy = await refreshGroupBuySuccessState(tx, groupBuy.id);
    const nextGroupStatus = refreshedGroupBuy?.is_success ? 'success' : groupBuy.status;

    const paidOrder = await tx.order.update({
      where: { id: order.id },
      data: { order_status: nextGroupStatus === 'success' ? 'grouped' : 'paid' }
    });

    await safeRecordBusinessEvent(tx, {
      event_type: 'payment_mark_order_paid',
      event_source: 'payment-service',
      order_id: order.id,
      group_buy_id: groupBuy.id,
      payment_id: paidPayment?.id ?? null,
      before_snapshot: order,
      after_snapshot: paidOrder,
      payload: { transaction_id: paidPayment?.transaction_id ?? paymentInfo.transaction_id ?? null, group_status: nextGroupStatus }
    });
    await safeRecordOrderTimeline(tx, {
      order_id: order.id,
      event_type: 'payment_mark_order_paid',
      title: '订单已支付',
      from_status: order.order_status,
      to_status: paidOrder.order_status,
      actor_type: 'system',
      payload: { payment_id: paidPayment?.id ?? null }
    });
    await ensureEstimatedCommission(order.id, tx);

    await tx.auditLog.create({
      data: {
        action: 'payment_mark_order_paid',
        target_type: 'Order',
        target_id: order.id,
        payload: {
          payment_id: paidPayment?.id ?? null,
          out_trade_no: paidPayment?.out_trade_no ?? paymentInfo.out_trade_no ?? null,
          quantity: order.quantity,
          group_buy_id: groupBuy.id,
          group_status: nextGroupStatus
        }
      }
    });

    return { order: paidOrder, payment: paidPayment };
  });
}
