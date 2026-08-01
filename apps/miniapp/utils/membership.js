const { request } = require('./api');

const getMembership = () => request({ url: '/api/me/membership' });
const activateLegacyMembership = (eligibilityId, idempotencyKey) => request({
  url: '/api/me/membership/legacy-activate', method: 'POST',
  data: { eligibility_id: eligibilityId, idempotency_key: idempotencyKey },
});
const claimMemberGift = (command) => request({
  url: '/api/me/member-gifts/claim', method: 'POST', data: command,
});
const releaseMemberGift = (claimId, idempotencyKey) => request({
  url: `/api/me/member-gifts/${claimId}/release`, method: 'POST',
  data: { idempotency_key: idempotencyKey },
});

const createPaidMembershipOrder = (idempotencyKey) => request({
  url: '/api/me/membership/orders', method: 'POST', data: { idempotency_key: idempotencyKey },
});

const requestPayment = (options) => new Promise((resolve, reject) => {
  wx.requestPayment({ ...options, success: resolve, fail: reject });
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForMembershipOrderPaid(membershipOrderId, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getMembership();
    const order = (status.membership_orders || []).find((item) => item.id === membershipOrderId);
    if (order && order.status === 'paid') return { order, membership: status };
    if (order && order.status === 'payment_exception') {
      throw new Error('支付已完成但权益未生效，客服将协助退款');
    }
    if (attempt < attempts - 1) await delay(500);
  }
  throw new Error('支付结果确认中，请稍后下拉刷新');
}

async function purchaseAnnualMembership(idempotencyKey) {
  const order = await createPaidMembershipOrder(idempotencyKey);
  const runtime = await request({ url: '/api/public/runtime' });
  if (runtime.payment_mode === 'mock') {
    return request({
      url: `/api/me/membership/orders/${order.membership_order_id}/mock-pay`, method: 'POST', data: {},
    });
  }
  const initialized = await request({
    url: `/api/me/membership/orders/${order.membership_order_id}/wechat-jsapi`, method: 'POST', data: {},
  });
  await requestPayment(initialized.wx_request_payment);
  return waitForMembershipOrderPaid(order.membership_order_id);
}

module.exports = {
  getMembership, activateLegacyMembership, claimMemberGift, releaseMemberGift,
  createPaidMembershipOrder, purchaseAnnualMembership,
  waitForMembershipOrderPaid,
};
