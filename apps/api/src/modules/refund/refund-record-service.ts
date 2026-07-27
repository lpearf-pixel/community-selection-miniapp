import {
  Prisma,
  type Refund,
} from '@prisma/client';

export type RefundRecordKeyInput = {
  order_id: string;
  out_refund_no: string;
  client_refund_id?: string;
  refund_amount_cents: number;
  product_refund_amount_cents?: number;
  delivery_refund_amount_cents?: number;
};

export type CreatePendingRefundInput = RefundRecordKeyInput & {
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  reason: string;
};

export type RefundNotifyInfo = {
  refund_id?: string;
  out_refund_no?: string;
  provider_status?: string;
  provider_success_at?: Date;
};

export function getRefundRecord(
  tx: Prisma.TransactionClient,
  refundId: string,
): Promise<Refund | null> {
  return tx.refund.findUnique({ where: { id: refundId } });
}

function assertRefundInputMatches(
  existing: Refund,
  input: RefundRecordKeyInput,
) {
  if (
    existing.order_id !== input.order_id
    || existing.refund_amount_cents !== input.refund_amount_cents
    || (
      input.product_refund_amount_cents !== undefined
      && existing.product_refund_amount_cents
        !== input.product_refund_amount_cents
    )
    || (
      input.delivery_refund_amount_cents !== undefined
      && existing.delivery_refund_amount_cents
        !== input.delivery_refund_amount_cents
    )
  ) {
    throw new Error('退款幂等键已被使用，且请求参数不一致');
  }
}

export async function findRefundByClientKey(
  tx: Prisma.TransactionClient,
  input: RefundRecordKeyInput,
): Promise<Refund | null> {
  const refund = input.client_refund_id
    ? await tx.refund.findUnique({
        where: { client_refund_id: input.client_refund_id },
      })
    : await tx.refund.findUnique({
        where: { out_refund_no: input.out_refund_no },
      });
  if (refund) assertRefundInputMatches(refund, input);
  return refund;
}

export function createPendingRefund(
  tx: Prisma.TransactionClient,
  input: CreatePendingRefundInput,
): Promise<Refund> {
  return tx.refund.create({
    data: {
      order_id: input.order_id,
      out_refund_no: input.out_refund_no,
      client_refund_id: input.client_refund_id,
      refund_amount_cents: input.refund_amount_cents,
      product_refund_amount_cents: input.product_refund_amount_cents,
      delivery_refund_amount_cents: input.delivery_refund_amount_cents,
      reason: input.reason,
      status: 'pending',
    },
  });
}

export async function confirmRefundSuccess(
  tx: Prisma.TransactionClient,
  refundId: string,
  notifyInfo: RefundNotifyInfo = {},
): Promise<{ refund: Refund; first_success: boolean }> {
  const refund = await tx.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new Error('退款单不存在');
  if (
    notifyInfo.out_refund_no
    && notifyInfo.out_refund_no !== refund.out_refund_no
  ) {
    throw new Error('微信退款单号与系统退款单不一致');
  }
  if (
    notifyInfo.refund_id
    && refund.refund_id
    && notifyInfo.refund_id !== refund.refund_id
  ) {
    throw new Error('微信 refund_id 与已有退款记录不一致');
  }
  if (notifyInfo.refund_id) {
    const providerOwner = await tx.refund.findUnique({
      where: { refund_id: notifyInfo.refund_id },
    });
    if (providerOwner && providerOwner.id !== refund.id) {
      throw new Error('微信 refund_id 与已有退款记录不一致');
    }
  }

  if (refund.status === 'success') {
    const data: Prisma.RefundUpdateInput = {};
    if (notifyInfo.refund_id && !refund.refund_id) {
      data.refund_id = notifyInfo.refund_id;
    }
    if (notifyInfo.provider_status !== undefined) {
      data.provider_status = notifyInfo.provider_status;
    }
    if (notifyInfo.provider_success_at && !refund.processed_at) {
      data.processed_at = notifyInfo.provider_success_at;
    }
    if (Object.keys(data).length === 0) {
      return { refund, first_success: false };
    }
    return {
      refund: await tx.refund.update({
        where: { id: refund.id },
        data,
      }),
      first_success: false,
    };
  }
  if (refund.status === 'rejected') throw new Error('已拒绝退款不可成功');

  return {
    refund: await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: 'success',
        refund_id: notifyInfo.refund_id ?? refund.refund_id,
        provider_status: notifyInfo.provider_status ?? 'SUCCESS',
        processed_at: notifyInfo.provider_success_at ?? new Date(),
        last_provider_error_code: null,
      },
    }),
    first_success: true,
  };
}

export function setRefundStockRestored(
  tx: Prisma.TransactionClient,
  refundId: string,
  restored: boolean,
): Promise<Refund> {
  return tx.refund.update({
    where: { id: refundId },
    data: { stock_restored: restored },
  });
}
