import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { ensureEstimatedCommission } from './commission-service.js';

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
      include: { group_buy: true }
    });
    if (!order) throw new Error('订单不存在');

    const payment = paymentInfo.payment_id
      ? await tx.payment.findUnique({ where: { id: paymentInfo.payment_id } })
      : paymentInfo.out_trade_no
        ? await tx.payment.findUnique({ where: { out_trade_no: paymentInfo.out_trade_no } })
        : await tx.payment.findFirst({ where: { order_id: order.id }, orderBy: { created_at: 'desc' } });

    if (order.pay_status === 'paid') {
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
      return { order, payment: paidPayment };
    }

    const groupBuy = order.group_buy;
    if (!groupBuy) throw new Error('订单不可支付');
    if (groupBuy.status !== 'pending' && groupBuy.status !== 'success') throw new Error('当前团购不可支付');
    if (groupBuy.end_time.getTime() <= Date.now()) throw new Error('团购已截止');

    const paidResult = await tx.order.updateMany({
      where: { id: order.id, pay_status: 'unpaid' },
      data: { pay_status: 'paid', paid_at: new Date() }
    });
    if (paidResult.count !== 1) {
      const latestOrder = await tx.order.findUnique({ where: { id: order.id }, include: { group_buy: true } });
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

    const updatedGroupBuy = await tx.groupBuy.update({
      where: { id: groupBuy.id },
      data: {
        current_people: { increment: 1 },
        current_quantity: { increment: order.quantity }
      }
    });
    const nextGroupStatus = updatedGroupBuy.current_people >= updatedGroupBuy.min_people || updatedGroupBuy.current_quantity >= updatedGroupBuy.min_quantity ? 'success' : updatedGroupBuy.status;

    if (nextGroupStatus === 'success' && updatedGroupBuy.status !== 'success') {
      await tx.groupBuy.update({
        where: { id: groupBuy.id },
        data: { status: 'success' }
      });
    }

    const paidOrder = await tx.order.update({
      where: { id: order.id },
      data: { order_status: nextGroupStatus === 'success' ? 'grouped' : 'paid' }
    });

    if (nextGroupStatus === 'success') {
      await tx.order.updateMany({
        where: { group_buy_id: groupBuy.id, pay_status: 'paid' },
        data: { order_status: 'grouped' }
      });
    }

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
