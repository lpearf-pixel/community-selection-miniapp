import { describe, expect, it } from 'vitest';
import {
  buildWechatShippingPayload,
  classifyWechatShippingError,
} from './wechat-shipping-policy.js';

describe('WeChat shipping payload policy', () => {
  it.each([
    [2, '同城配送'],
    [4, '用户自提'],
  ] as const)('builds a unified %s payload for %s', (logisticsType, _label) => {
    expect(
      buildWechatShippingPayload(
        {
          transactionId: '4200000000000000000000000001',
          openid: 'openid-one',
          itemDescription: '  有机蔬菜\u0000 组合装  ',
          logisticsType,
        },
        new Date('2026-07-29T12:00:00.000Z'),
      ),
    ).toEqual({
      order_key: {
        order_number_type: 1,
        transaction_id: '4200000000000000000000000001',
      },
      delivery_mode: 1,
      logistics_type: logisticsType,
      shipping_list: [{ item_desc: '有机蔬菜 组合装' }],
      upload_time: '2026-07-29T12:00:00.000Z',
      payer: { openid: 'openid-one' },
    });
  });

  it('rejects missing real identifiers before building a payload', () => {
    expect(() =>
      buildWechatShippingPayload({
        transactionId: '',
        openid: 'openid-one',
        itemDescription: '蔬菜',
        logisticsType: 2,
      }),
    ).toThrow('WECHAT_SHIPPING_PAYMENT_ID_MISSING');
    expect(() =>
      buildWechatShippingPayload({
        transactionId: '420001',
        openid: '',
        itemDescription: '蔬菜',
        logisticsType: 4,
      }),
    ).toThrow('WECHAT_SHIPPING_OPENID_MISSING');
  });

  it.each([
    ['WECHAT_SHIPPING_NETWORK', 'retryable'],
    ['WECHAT_SHIPPING_TIMEOUT', 'retryable'],
    ['WECHAT_SHIPPING_HTTP_429', 'retryable'],
    ['WECHAT_SHIPPING_HTTP_503', 'retryable'],
    ['WECHAT_SHIPPING_-1', 'retryable'],
    ['WECHAT_SHIPPING_45009', 'retryable'],
    ['WECHAT_SHIPPING_40013', 'manual'],
    ['WECHAT_SHIPPING_PAYMENT_ID_MISSING', 'manual'],
    ['untrusted provider text', 'manual'],
  ] as const)('classifies %s as %s', (message, kind) => {
    expect(classifyWechatShippingError(new Error(message))).toEqual({
      kind,
      code: /^[A-Z0-9_-]{1,96}$/.test(message)
        ? message
        : 'WECHAT_SHIPPING_UNKNOWN',
    });
  });
});
