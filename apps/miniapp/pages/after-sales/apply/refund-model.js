const DELIVERY_REFUND_TYPES = new Set([
  'delivery_not_started',
  'delivery_failed',
  'severe_delay',
  'whole_order_unfulfillable'
]);

function parseRefundYuan(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('请输入有效的商品退款金额');
  }
  const [yuan, fraction = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error('请输入有效的商品退款金额');
  }
  return cents;
}

function refundDefaultsForType(type) {
  const eligible = DELIVERY_REFUND_TYPES.has(type);
  return {
    delivery_refund_eligible: eligible,
    delivery_refund_notice: eligible
      ? '配送费是否退还由商家审核决定'
      : '商品问题默认只退商品金额，不退配送费'
  };
}

module.exports = { parseRefundYuan, refundDefaultsForType };
