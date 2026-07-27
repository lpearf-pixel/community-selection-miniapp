function defaultRequestPayment(input) {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...input,
      success: resolve,
      fail: reject,
    });
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPaymentController(dependencies) {
  const request = dependencies.request;
  const requestPayment =
    dependencies.requestPayment || defaultRequestPayment;
  const sleep = dependencies.sleep || defaultSleep;
  let runtime = null;

  async function getRuntime() {
    if (!runtime) {
      runtime = await request({
        url: '/api/public/runtime',
        method: 'GET',
      });
    }
    if (!runtime || !['mock', 'wechat'].includes(runtime.payment_mode)) {
      throw new Error('支付运行模式无效');
    }
    return runtime;
  }

  async function pollPaymentStatus(orderId) {
    let latest = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await sleep(1_000);
      latest = await request({
        url: `/api/me/orders/${orderId}/payment-status`,
        method: 'GET',
      });
      if (latest && latest.pay_status === 'paid') return latest;
    }
    return latest;
  }

  async function payOrder(orderId) {
    const currentRuntime = await getRuntime();
    if (currentRuntime.payment_mode === 'mock') {
      return request({
        url: '/api/payments/mock',
        method: 'POST',
        data: { order_id: orderId },
      });
    }
    const initialized = await request({
      url: '/api/payments/wechat/jsapi',
      method: 'POST',
      data: { order_id: orderId },
    });
    if (!initialized || !initialized.wx_request_payment) {
      throw new Error('微信支付参数缺失');
    }
    await requestPayment(initialized.wx_request_payment);
    return pollPaymentStatus(orderId);
  }

  return { getRuntime, payOrder, pollPaymentStatus };
}

function payOrder(orderId) {
  const { request } = require('./api');
  return createPaymentController({ request }).payOrder(orderId);
}

module.exports = {
  createPaymentController,
  payOrder,
};
