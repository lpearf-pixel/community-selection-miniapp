const giftStatus = { reserved: '待领取', released: '已取消', delivered: '已交付', written_off: '已报损' };

function buildMembershipView(value) {
  const input = value || {};
  const eligibility = input.legacy_eligibility || null;
  return {
    ...input,
    membershipStatusText: input.active ? '会员有效' : input.feature_enabled ? '尚未开通会员' : '会员权益暂未开放',
    annualPriceCents: input.annual_price_cents || 8800,
    canActivateLegacy: Boolean(input.feature_enabled && !input.active && eligibility && eligibility.status === 'active'),
    campaigns: input.active_gift_campaigns || [],
    giftClaims: (input.gift_claims || []).map((item) => ({ ...item, statusText: giftStatus[item.status] || item.status })),
  };
}

function buildGiftClaimCommand(input) {
  if (!input.orderId) throw new Error('缺少赠品履约订单');
  if (!input.campaignId) throw new Error('请选择赠品活动');
  if (!input.idempotencyKey) throw new Error('缺少领取幂等键');
  return { order_id: input.orderId, campaign_id: input.campaignId, idempotency_key: input.idempotencyKey };
}

function membershipOrderState(value, membershipOrderId) {
  const order = ((value && value.membership_orders) || []).find((item) => item.id === membershipOrderId);
  if (!order) return 'pending';
  if (order.status === 'paid') return 'paid';
  if (order.status === 'payment_exception') return 'exception';
  return 'pending';
}

module.exports = { buildMembershipView, buildGiftClaimCommand, membershipOrderState };
