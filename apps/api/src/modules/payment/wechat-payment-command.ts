import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

type PreparedPayment = {
  order: {
    id: string;
    order_no: string;
    pay_amount_cents: number;
    openid: string;
    description: string;
  };
  payment: {
    id: string;
    out_trade_no: string;
    prepay_id: string | null;
    prepay_expires_at: Date | null;
  };
};

export type WechatPaymentStore = {
  prepare(
    userId: string,
    orderId: string,
    now: Date,
  ): Promise<PreparedPayment>;
  savePrepay(
    paymentId: string,
    prepayId: string,
    expiresAt: Date,
  ): Promise<void>;
};

export type WechatPaymentClient = {
  createJsapiTransaction(input: {
    description: string;
    outTradeNo: string;
    amountCents: number;
    openid: string;
    expiresAt: Date;
    attach: string;
    clientIp?: string;
  }): Promise<{ prepayId: string }>;
};

function merchantOrderNo(orderId: string, orderNo: string, attemptNo: number) {
  const digest = createHash('sha256')
    .update(`${orderId}:${orderNo}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
  return `PAY${digest}${String(attemptNo).padStart(3, '0')}`;
}

export function createPrismaWechatPaymentStore(
  client: typeof prisma = prisma,
): WechatPaymentStore {
  return {
    prepare(userId, orderId, now) {
      return client.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`
          SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
        `;
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { user: true, group_buy: true, product: true },
        });
        if (!order) throw new Error('PAYMENT_ORDER_NOT_FOUND');
        if (order.user_id !== userId) throw new Error('PAYMENT_ORDER_FORBIDDEN');
        if (order.user.status !== 'active') {
          throw new Error('PAYMENT_USER_DISABLED');
        }
        if (order.pay_status !== 'unpaid' || order.order_status !== 'unpaid') {
          throw new Error('PAYMENT_ORDER_NOT_PAYABLE');
        }
        if (
          order.group_buy &&
          (order.group_buy.status !== 'pending' ||
            order.group_buy.end_time.getTime() <= now.getTime())
        ) {
          throw new Error('PAYMENT_GROUP_EXPIRED');
        }

        const latest = await tx.payment.findFirst({
          where: { order_id: order.id },
          orderBy: { attempt_no: 'desc' },
        });
        if (
          latest?.prepay_id &&
          latest.prepay_expires_at &&
          latest.prepay_expires_at.getTime() > now.getTime() &&
          ['created', 'prepay'].includes(latest.trade_state)
        ) {
          return {
            order: {
              id: order.id,
              order_no: order.order_no,
              pay_amount_cents: order.pay_amount_cents,
              openid: order.user.openid,
              description: `有机蔬菜订单 ${order.order_no}`,
            },
            payment: latest,
          };
        }
        const attemptNo = (latest?.attempt_no ?? 0) + 1;
        const payment = await tx.payment.create({
          data: {
            order_id: order.id,
            attempt_no: attemptNo,
            out_trade_no: merchantOrderNo(
              order.id,
              order.order_no,
              attemptNo,
            ),
            amount_cents: order.pay_amount_cents,
            trade_state: 'created',
          },
        });
        return {
          order: {
            id: order.id,
            order_no: order.order_no,
            pay_amount_cents: order.pay_amount_cents,
            openid: order.user.openid,
            description: `有机蔬菜订单 ${order.order_no}`,
          },
          payment,
        };
      });
    },

    async savePrepay(paymentId, prepayId, expiresAt) {
      await client.payment.update({
        where: { id: paymentId },
        data: {
          prepay_id: prepayId,
          prepay_expires_at: expiresAt,
          trade_state: 'prepay',
          last_provider_error_code: null,
        },
      });
    },
  };
}

export function createWechatPaymentCommand(options: {
  store: WechatPaymentStore;
  payClient: WechatPaymentClient;
  signJsapi(input: { prepayId: string }): {
    timeStamp: string;
    nonceStr: string;
    package: string;
    signType: 'RSA';
    paySign: string;
  };
  now?: () => Date;
  prepayWindowMs?: number;
}) {
  const now = options.now ?? (() => new Date());
  const prepayWindowMs = options.prepayWindowMs ?? 15 * 60 * 1_000;
  return {
    async initialize(input: {
      userId: string;
      orderId: string;
      clientIp?: string;
    }) {
      const current = now();
      const prepared = await options.store.prepare(
        input.userId,
        input.orderId,
        current,
      );
      let prepayId =
        prepared.payment.prepay_id &&
        prepared.payment.prepay_expires_at &&
        prepared.payment.prepay_expires_at.getTime() > current.getTime()
          ? prepared.payment.prepay_id
          : null;
      const expiresAt = new Date(current.getTime() + prepayWindowMs);
      if (!prepayId) {
        const provider = await options.payClient.createJsapiTransaction({
          description: prepared.order.description,
          outTradeNo: prepared.payment.out_trade_no,
          amountCents: prepared.order.pay_amount_cents,
          openid: prepared.order.openid,
          expiresAt,
          attach: prepared.order.id,
          ...(input.clientIp ? { clientIp: input.clientIp } : {}),
        });
        prepayId = provider.prepayId;
        await options.store.savePrepay(
          prepared.payment.id,
          prepayId,
          expiresAt,
        );
      }
      return {
        order_id: prepared.order.id,
        out_trade_no: prepared.payment.out_trade_no,
        amount_cents: prepared.order.pay_amount_cents,
        wx_request_payment: options.signJsapi({ prepayId }),
      };
    },
  };
}
