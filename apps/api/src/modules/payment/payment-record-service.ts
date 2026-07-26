import type { Payment, Prisma } from '@prisma/client';

export type PaymentInfo = {
  payment_id?: string;
  out_trade_no?: string;
  transaction_id?: string;
  raw_notify?: Prisma.InputJsonValue;
};

export async function findPaymentForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  info: PaymentInfo,
): Promise<Payment | null> {
  if (info.payment_id) {
    return tx.payment.findUnique({ where: { id: info.payment_id } });
  }
  if (info.out_trade_no) {
    return tx.payment.findUnique({
      where: { out_trade_no: info.out_trade_no },
    });
  }
  return tx.payment.findFirst({
    where: { order_id: orderId },
    orderBy: { created_at: 'desc' },
  });
}

export async function confirmPaymentRecordPaid(
  tx: Prisma.TransactionClient,
  payment: Payment | null,
  info: PaymentInfo,
): Promise<Payment | null> {
  if (!payment) return null;
  return tx.payment.update({
    where: { id: payment.id },
    data: {
      trade_state: 'paid',
      transaction_id: payment.transaction_id ?? info.transaction_id,
      ...(info.raw_notify === undefined ? {} : { raw_notify: info.raw_notify }),
    },
  });
}
