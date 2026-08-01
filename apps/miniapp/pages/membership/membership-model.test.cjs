const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMembershipView,
  buildGiftClaimCommand,
  membershipOrderState,
} = require('./membership-model');

test('builds active membership and auditable gift status labels', () => {
  const view = buildMembershipView({
    feature_enabled: true,
    active: true,
    ends_at: '2027-07-31T00:00:00.000Z',
    legacy_eligibility: { id: 'eligibility-1', status: 'used' },
    active_gift_campaigns: [{ id: 'campaign-1', name: '新品试吃', gift_product_name: '有机番茄' }],
    gift_claims: [{ id: 'claim-1', status: 'reserved', campaign_name: '新品试吃' }],
  });
  assert.equal(view.membershipStatusText, '会员有效');
  assert.equal(view.annualPriceCents, 8800);
  assert.equal(view.canActivateLegacy, false);
  assert.equal(view.giftClaims[0].statusText, '待领取');
  assert.equal(view.campaigns[0].gift_product_name, '有机番茄');
});

test('does not present membership success before the server marks the order paid', () => {
  assert.equal(membershipOrderState({
    membership_orders: [{ id: 'membership-order-1', status: 'pending_payment' }],
  }, 'membership-order-1'), 'pending');
  assert.equal(membershipOrderState({
    membership_orders: [{ id: 'membership-order-1', status: 'paid' }],
  }, 'membership-order-1'), 'paid');
  assert.equal(membershipOrderState({
    membership_orders: [{ id: 'membership-order-1', status: 'payment_exception' }],
  }, 'membership-order-1'), 'exception');
});

test('only exposes legacy activation for an active unused eligibility', () => {
  const active = buildMembershipView({
    feature_enabled: true, active: false,
    legacy_eligibility: { id: 'eligibility-1', status: 'active' },
  });
  const disabled = buildMembershipView({
    feature_enabled: false, active: false,
    legacy_eligibility: { id: 'eligibility-1', status: 'active' },
  });
  assert.equal(active.canActivateLegacy, true);
  assert.equal(disabled.canActivateLegacy, false);
});

test('requires both a paid order and campaign to build a gift claim command', () => {
  assert.deepEqual(buildGiftClaimCommand({ orderId: 'order-1', campaignId: 'campaign-1', idempotencyKey: 'claim-1' }), {
    order_id: 'order-1', campaign_id: 'campaign-1', idempotency_key: 'claim-1',
  });
  assert.throws(() => buildGiftClaimCommand({ orderId: '', campaignId: 'campaign-1', idempotencyKey: 'claim-1' }), /订单/);
});
