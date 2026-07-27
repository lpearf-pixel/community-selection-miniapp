export type WechatRefundIntent = {
  refund_id: string;
  order_id: string;
  out_trade_no: string;
  out_refund_no: string;
  refund_amount_cents: number;
  total_amount_cents: number;
  reason: string;
  provider_status: string | null;
};

type RefundCommandInput = {
  order_id: string;
  client_refund_id: string;
  refund_amount_cents: number;
  product_refund_amount_cents?: number;
  delivery_refund_amount_cents?: number;
  reason: string;
};

function stableProviderError(error: unknown): string {
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'WECHAT_REFUND_PROVIDER_UNKNOWN';
}

function providerString(
  response: Record<string, unknown>,
  key: string,
): string | null {
  const value = response[key];
  return typeof value === 'string' && value ? value : null;
}

export function createWechatRefundCommand(options: {
  createIntent(input: RefundCommandInput): Promise<WechatRefundIntent>;
  applyRefund(input: {
    outTradeNo: string;
    outRefundNo: string;
    refundAmountCents: number;
    totalAmountCents: number;
    reason: string;
  }): Promise<Record<string, unknown>>;
  saveProviderResult(
    refundId: string,
    result: {
      refund_id?: string;
      provider_status: string | null;
      last_provider_error_code: string | null;
    },
  ): Promise<void>;
}) {
  return {
    async submit(input: RefundCommandInput) {
      const intent = await options.createIntent(input);
      if (intent.provider_status) return intent;
      try {
        const provider = await options.applyRefund({
          outTradeNo: intent.out_trade_no,
          outRefundNo: intent.out_refund_no,
          refundAmountCents: intent.refund_amount_cents,
          totalAmountCents: intent.total_amount_cents,
          reason: intent.reason,
        });
        const providerStatus = providerString(provider, 'status');
        const providerRefundId = providerString(provider, 'refund_id');
        await options.saveProviderResult(intent.refund_id, {
          ...(providerRefundId ? { refund_id: providerRefundId } : {}),
          provider_status: providerStatus,
          last_provider_error_code: null,
        });
        return {
          ...intent,
          refund_id_provider: providerRefundId,
          provider_status: providerStatus,
        };
      } catch (error) {
        await options.saveProviderResult(intent.refund_id, {
          provider_status: null,
          last_provider_error_code: stableProviderError(error),
        });
        throw error;
      }
    },
  };
}

export type WechatRefundCommand = ReturnType<
  typeof createWechatRefundCommand
>;

export function submitWechatRefund(
  command: WechatRefundCommand,
  input: Parameters<WechatRefundCommand['submit']>[0],
) {
  return command.submit(input);
}
