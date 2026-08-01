const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentController } = require('./payment');
const paymentAdapterSource = require('node:fs').readFileSync(require('node:path').join(__dirname, 'payment.js'), 'utf8');
const membershipSource = require('node:fs').readFileSync(require('node:path').join(__dirname, 'membership.js'), 'utf8');

test('keeps every wx.requestPayment call inside the payment adapter', () => {
  assert.match(paymentAdapterSource, /wx\.requestPayment/);
  assert.doesNotMatch(membershipSource, /wx\.requestPayment/);
  assert.match(membershipSource, /requestWechatPayment/);
});

test('real mode invokes JSAPI then wx.requestPayment and polls backend state', async () => {
  const calls = [];
  const controller = createPaymentController({
    request: async (options) => {
      calls.push(options);
      if (options.url === '/api/public/runtime') {
        return { payment_mode: 'wechat' };
      }
      if (options.url === '/api/payments/wechat/jsapi') {
        assert.deepEqual(options.data, { order_id: 'order-a' });
        return {
          wx_request_payment: {
            timeStamp: '1',
            nonceStr: 'nonce',
            package: 'prepay_id=prepay-a',
            signType: 'RSA',
            paySign: 'signature',
          },
        };
      }
      return { pay_status: 'paid', order_status: 'paid' };
    },
    requestPayment: async (input) => {
      assert.equal(input.package, 'prepay_id=prepay-a');
    },
    sleep: async () => undefined,
  });

  const result = await controller.payOrder('order-a');

  assert.equal(result.pay_status, 'paid');
  assert.equal(calls.at(-1).url, '/api/me/orders/order-a/payment-status');
});

test('mock endpoint is used only when backend runtime explicitly enables mock', async () => {
  const calls = [];
  const controller = createPaymentController({
    request: async (options) => {
      calls.push(options);
      if (options.url === '/api/public/runtime') return { payment_mode: 'mock' };
      return { pay_status: 'paid', mock: true };
    },
    requestPayment: async () => assert.fail('must not call wx.requestPayment'),
    sleep: async () => undefined,
  });

  await controller.payOrder('order-a');
  assert.equal(calls[1].url, '/api/payments/mock');
});

test('user cancellation leaves payment state to the backend', async () => {
  const calls = [];
  const controller = createPaymentController({
    request: async (options) => {
      calls.push(options);
      if (options.url === '/api/public/runtime') return { payment_mode: 'wechat' };
      return { wx_request_payment: { package: 'prepay_id=prepay-a' } };
    },
    requestPayment: async () => {
      const error = new Error('requestPayment:fail cancel');
      error.errMsg = 'requestPayment:fail cancel';
      throw error;
    },
    sleep: async () => undefined,
  });

  await assert.rejects(controller.payOrder('order-a'), /cancel/);
  assert.equal(
    calls.some((call) => call.url.includes('payment-status')),
    false,
  );
});
