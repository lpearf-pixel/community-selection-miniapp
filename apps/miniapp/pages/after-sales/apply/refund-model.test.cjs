const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRefundYuan,
  refundDefaultsForType,
} = require('./refund-model');

test('parses a user-entered yuan amount into integer cents', () => {
  assert.equal(parseRefundYuan('12.34'), 1234);
  assert.equal(parseRefundYuan('12'), 1200);
});

test('rejects zero, excess precision, unsafe, and non-numeric amounts', () => {
  for (const value of ['', '0', '-1', '1.001', 'abc', '900719925474099']) {
    assert.throws(() => parseRefundYuan(value), /请输入有效的商品退款金额/);
  }
});

test('product issues never request delivery fee while delivery failures disclose merchant review', () => {
  assert.deepEqual(refundDefaultsForType('bad_quality'), {
    delivery_refund_eligible: false,
    delivery_refund_notice: '商品问题默认只退商品金额，不退配送费',
  });
  assert.deepEqual(refundDefaultsForType('delivery_failed'), {
    delivery_refund_eligible: true,
    delivery_refund_notice: '配送费是否退还由商家审核决定',
  });
});
