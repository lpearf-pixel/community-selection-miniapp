export type WechatShippingPayload = {
  order_key: {
    order_number_type: 1;
    transaction_id: string;
  };
  delivery_mode: 1;
  logistics_type: 2 | 4;
  shipping_list: Array<{ item_desc: string }>;
  upload_time: string;
  payer: { openid: string };
};

function required(
  value: string,
  code: string,
): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function itemDescription(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!normalized) {
    throw new Error('WECHAT_SHIPPING_ITEM_DESCRIPTION_MISSING');
  }
  return normalized;
}

export function buildWechatShippingPayload(
  input: {
    transactionId: string;
    openid: string;
    itemDescription: string;
    logisticsType: 2 | 4;
  },
  uploadedAt = new Date(),
): WechatShippingPayload {
  return {
    order_key: {
      order_number_type: 1,
      transaction_id: required(
        input.transactionId,
        'WECHAT_SHIPPING_PAYMENT_ID_MISSING',
      ),
    },
    delivery_mode: 1,
    logistics_type: input.logisticsType,
    shipping_list: [
      { item_desc: itemDescription(input.itemDescription) },
    ],
    upload_time: uploadedAt.toISOString(),
    payer: {
      openid: required(
        input.openid,
        'WECHAT_SHIPPING_OPENID_MISSING',
      ),
    },
  };
}

function safeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    /^WECHAT_(?:SHIPPING|ACCESS_TOKEN)_[A-Z0-9_-]{1,72}$/.test(
      error.message,
    )
  ) {
    return error.message;
  }
  return 'WECHAT_SHIPPING_UNKNOWN';
}

export function classifyWechatShippingError(error: unknown): {
  kind: 'retryable' | 'manual';
  code: string;
} {
  const code = safeErrorCode(error);
  const retryable =
    code === 'WECHAT_SHIPPING_NETWORK' ||
    code === 'WECHAT_SHIPPING_TIMEOUT' ||
    code === 'WECHAT_ACCESS_TOKEN_NETWORK' ||
    code === 'WECHAT_ACCESS_TOKEN_TIMEOUT' ||
    code === 'WECHAT_SHIPPING_-1' ||
    code === 'WECHAT_SHIPPING_45009' ||
    /^WECHAT_(?:SHIPPING|ACCESS_TOKEN)_HTTP_(?:429|5\d\d)$/.test(
      code,
    );
  return {
    kind: retryable ? 'retryable' : 'manual',
    code,
  };
}
