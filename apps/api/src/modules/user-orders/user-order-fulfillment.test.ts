import { describe, expect, it } from 'vitest';
import { toUserFulfillment } from './user-order-service.js';

describe('L53-B user fulfillment DTO', () => {
  it('uses the stored delivery state and promise snapshot', () => {
    expect(
      toUserFulfillment({
        pickup_type: 'delivery',
        order_status: 'paid',
        delivery_status: 'delivering',
        fulfillment_promise_snapshot: {
          schema_version: 1,
          display_text: '今日下午 14:00-18:00',
        },
        promised_fulfillment_start_at: new Date(
          '2026-07-29T06:00:00.000Z',
        ),
        promised_fulfillment_end_at: new Date(
          '2026-07-29T10:00:00.000Z',
        ),
      }),
    ).toEqual({
      fulfillment_status: 'delivering',
      fulfillment_status_text: '配送中',
      fulfillment_promise: {
        display_text: '今日下午 14:00-18:00',
        promised_start_at: '2026-07-29T06:00:00.000Z',
        promised_end_at: '2026-07-29T10:00:00.000Z',
        snapshot: {
          schema_version: 1,
          display_text: '今日下午 14:00-18:00',
        },
      },
    });
  });

  it.each([
    ['pending_dispatch', '待配送'],
    ['delivering', '配送中'],
    ['delivered', '已送达'],
    ['exception', '配送异常'],
  ] as const)('labels persisted delivery status %s', (status, text) => {
    expect(
      toUserFulfillment({
        pickup_type: 'delivery',
        order_status: 'paid',
        delivery_status: status,
        fulfillment_promise_snapshot: null,
        promised_fulfillment_start_at: null,
        promised_fulfillment_end_at: null,
      }).fulfillment_status_text,
    ).toBe(text);
  });

  it.each([
    ['ready', 'ready_for_pickup', '待自提'],
    ['picked', 'picked_up', '已自提'],
    ['preparing', 'preparing_pickup', '备货中'],
  ] as const)(
    'derives pickup fulfillment from command-owned order state %s',
    (orderStatus, expectedStatus, expectedText) => {
      expect(
        toUserFulfillment({
          pickup_type: 'store',
          order_status: orderStatus,
          delivery_status: null,
          fulfillment_promise_snapshot: null,
          promised_fulfillment_start_at: null,
          promised_fulfillment_end_at: null,
        }),
      ).toMatchObject({
        fulfillment_status: expectedStatus,
        fulfillment_status_text: expectedText,
      });
    },
  );

  it('marks a historical order promise unavailable without recomputing a rule', () => {
    expect(
      toUserFulfillment({
        pickup_type: 'delivery',
        order_status: 'paid',
        delivery_status: 'pending_dispatch',
        fulfillment_promise_snapshot: null,
        promised_fulfillment_start_at: null,
        promised_fulfillment_end_at: null,
      }).fulfillment_promise,
    ).toEqual({
      display_text: '历史订单未保存承诺时段',
      promised_start_at: null,
      promised_end_at: null,
      snapshot: null,
    });
  });
});
