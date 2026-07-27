type PaymentCandidate = {
  id: string;
  order_id: string;
  out_trade_no: string;
};

type RefundCandidate = {
  id: string;
  out_refund_no: string;
};

function requiredString(
  value: unknown,
  errorCode: string,
): string {
  if (typeof value !== 'string' || !value) throw new Error(errorCode);
  return value;
}

function providerDate(value: unknown, errorCode: string): Date {
  const result = new Date(requiredString(value, errorCode));
  if (Number.isNaN(result.getTime())) throw new Error(errorCode);
  return result;
}

function stableError(error: unknown, fallback: string): string {
  return error instanceof Error &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
    ? error.message
    : fallback;
}

export function createWechatReconciler(options: {
  acquireLock(): Promise<boolean>;
  listPendingPayments(now: Date): Promise<PaymentCandidate[]>;
  queryTransaction(outTradeNo: string): Promise<Record<string, unknown>>;
  markOrderPaid(
    orderId: string,
    info: {
      payment_id: string;
      out_trade_no: string;
      transaction_id: string;
      provider_success_at: Date;
    },
  ): Promise<unknown>;
  updatePaymentState(
    paymentId: string,
    state: string | null,
    now: Date,
    errorCode: string | null,
  ): Promise<unknown>;
  listPendingRefunds(now: Date): Promise<RefundCandidate[]>;
  queryRefund(outRefundNo: string): Promise<Record<string, unknown>>;
  markRefundSuccess(
    refundId: string,
    info: {
      refund_id: string;
      out_refund_no: string;
      provider_status: string;
      provider_success_at: Date;
    },
  ): Promise<unknown>;
  updateRefundState(
    refundId: string,
    state: string | null,
    now: Date,
    errorCode: string | null,
  ): Promise<unknown>;
  upsertAlert(
    key: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
}) {
  return {
    async reconcile(now: Date) {
      if (!(await options.acquireLock())) {
        return { skipped: true, payments: 0, refunds: 0 };
      }
      const payments = await options.listPendingPayments(now);
      for (const payment of payments) {
        try {
          const provider = await options.queryTransaction(
            payment.out_trade_no,
          );
          const state = requiredString(
            provider.trade_state,
            'WECHAT_PAYMENT_QUERY_STATE_INVALID',
          );
          if (state === 'SUCCESS') {
            await options.markOrderPaid(payment.order_id, {
              payment_id: payment.id,
              out_trade_no: payment.out_trade_no,
              transaction_id: requiredString(
                provider.transaction_id,
                'WECHAT_PAYMENT_QUERY_TRANSACTION_ID_INVALID',
              ),
              provider_success_at: providerDate(
                provider.success_time,
                'WECHAT_PAYMENT_QUERY_SUCCESS_TIME_INVALID',
              ),
            });
          }
          await options.updatePaymentState(payment.id, state, now, null);
          if (['PAYERROR', 'REVOKED'].includes(state)) {
            await options.upsertAlert(
              `wechat-payment:${payment.id}:${state}`,
              { payment_id: payment.id, provider_state: state },
            );
          }
        } catch (error) {
          const code = stableError(
            error,
            'WECHAT_PAYMENT_RECONCILE_FAILED',
          );
          await options.updatePaymentState(payment.id, null, now, code);
          await options.upsertAlert(
            `wechat-payment:${payment.id}:${code}`,
            { payment_id: payment.id, error_code: code },
          );
        }
      }

      const refunds = await options.listPendingRefunds(now);
      for (const refund of refunds) {
        try {
          const provider = await options.queryRefund(refund.out_refund_no);
          const state = requiredString(
            provider.status,
            'WECHAT_REFUND_QUERY_STATE_INVALID',
          );
          if (state === 'SUCCESS') {
            await options.markRefundSuccess(refund.id, {
              refund_id: requiredString(
                provider.refund_id,
                'WECHAT_REFUND_QUERY_ID_INVALID',
              ),
              out_refund_no: refund.out_refund_no,
              provider_status: state,
              provider_success_at: providerDate(
                provider.success_time,
                'WECHAT_REFUND_QUERY_SUCCESS_TIME_INVALID',
              ),
            });
          }
          await options.updateRefundState(refund.id, state, now, null);
          if (['CLOSED', 'ABNORMAL'].includes(state)) {
            await options.upsertAlert(
              `wechat-refund:${refund.id}:${state}`,
              { refund_id: refund.id, provider_state: state },
            );
          }
        } catch (error) {
          const code = stableError(
            error,
            'WECHAT_REFUND_RECONCILE_FAILED',
          );
          await options.updateRefundState(refund.id, null, now, code);
          await options.upsertAlert(
            `wechat-refund:${refund.id}:${code}`,
            { refund_id: refund.id, error_code: code },
          );
        }
      }
      return {
        skipped: false,
        payments: payments.length,
        refunds: refunds.length,
      };
    },
  };
}

export async function reconcileWechatState(
  reconciler: ReturnType<typeof createWechatReconciler>,
  now = new Date(),
) {
  return reconciler.reconcile(now);
}
