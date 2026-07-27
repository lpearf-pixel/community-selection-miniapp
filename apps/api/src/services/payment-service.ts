import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import {
  refreshGroupBuyAfterPayment,
} from '../modules/group-buy/group-buy-payment-service.js';
import {
  deductInventoryForPaidOrder,
} from '../modules/inventory/inventory-order-service.js';
import {
  claimOrderPayment,
  markGroupPaidOrdersGrouped,
  recordPaidOrderEffects,
  setPaidOrderStatus,
} from '../modules/order/order-payment-service.js';
import {
  confirmPaymentRecordPaid,
  findPaymentForOrder,
  type PaymentInfo,
} from '../modules/payment/payment-record-service.js';
import { ensureEstimatedCommission } from './commission-service.js';
import { recordBusinessEvent } from './logging-service.js';

export async function refreshGroupBuySuccessState(
  tx: Prisma.TransactionClient,
  groupBuyId: string,
) {
  return refreshGroupBuyAfterPayment(tx, groupBuyId, new Date());
}

export async function markOrderPaid(
  orderId: string,
  paymentInfo: PaymentInfo = {},
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { group_buy: true, product: true },
    });
    if (!order) throw new Error('订单不存在');
    const paidAt = paymentInfo.provider_success_at ?? new Date();

    const payment = await findPaymentForOrder(tx, order.id, paymentInfo);

    if (order.pay_status === 'paid') {
      await recordBusinessEvent(tx, {
        event_type: 'payment_duplicate_ignored',
        event_level: 'warning',
        event_source: 'payment-service',
        order_id: order.id,
        payment_id: payment?.id ?? null,
        payload: {
          out_trade_no:
            payment?.out_trade_no ?? paymentInfo.out_trade_no ?? null,
        },
      });
      const paidPayment = await confirmPaymentRecordPaid(
        tx,
        payment,
        paymentInfo,
      );
      if (order.group_buy_id) {
        const progress = await refreshGroupBuyAfterPayment(
          tx,
          order.group_buy_id,
          paidAt,
        );
        if (progress?.is_success) {
          await markGroupPaidOrdersGrouped(tx, order.group_buy_id);
        }
      }
      return { order, payment: paidPayment };
    }

    const groupBuy = order.group_buy;
    if (!groupBuy && !order.product_id) throw new Error('订单不可支付');
    if (groupBuy) {
      if (groupBuy.status !== 'pending' && groupBuy.status !== 'success') {
        throw new Error('当前团购不可支付');
      }
      if (groupBuy.end_time.getTime() < paidAt.getTime()) {
        throw new Error('团购已截止');
      }
    }

    await deductInventoryForPaidOrder(tx, {
      order,
      operator_user_id: order.user_id,
    });
    const claimed = await claimOrderPayment(tx, order.id, paidAt);
    if (!claimed.claimed) {
      return { order: claimed.order, payment };
    }

    const paidPayment = await confirmPaymentRecordPaid(
      tx,
      payment,
      paymentInfo,
    );

    if (!groupBuy) {
      const paidOrder = await setPaidOrderStatus(tx, order.id, 'paid');
      await recordPaidOrderEffects(tx, {
        beforeOrder: order,
        paidOrder,
        paymentId: paidPayment?.id ?? null,
        transactionId:
          paidPayment?.transaction_id ?? paymentInfo.transaction_id ?? null,
        groupBuyId: null,
        groupStatus: null,
      });
      return { order: paidOrder, payment: paidPayment };
    }

    const progress = await refreshGroupBuyAfterPayment(
      tx,
      groupBuy.id,
      paidAt,
    );
    const nextGroupStatus = progress?.is_success
      ? 'success'
      : progress?.status ?? groupBuy.status;
    if (progress?.is_success) {
      await markGroupPaidOrdersGrouped(tx, groupBuy.id);
    }
    const paidOrder = await setPaidOrderStatus(
      tx,
      order.id,
      progress?.is_success ? 'grouped' : 'paid',
    );

    await recordPaidOrderEffects(tx, {
      beforeOrder: order,
      paidOrder,
      paymentId: paidPayment?.id ?? null,
      transactionId:
        paidPayment?.transaction_id ?? paymentInfo.transaction_id ?? null,
      groupBuyId: groupBuy.id,
      groupStatus: nextGroupStatus,
    });
    await ensureEstimatedCommission(order.id, tx);

    await tx.auditLog.create({
      data: {
        action: 'payment_mark_order_paid',
        target_type: 'Order',
        target_id: order.id,
        payload: {
          payment_id: paidPayment?.id ?? null,
          out_trade_no:
            paidPayment?.out_trade_no ?? paymentInfo.out_trade_no ?? null,
          quantity: order.quantity,
          group_buy_id: groupBuy.id,
          group_status: nextGroupStatus,
        },
      },
    });

    return { order: paidOrder, payment: paidPayment };
  });
}
