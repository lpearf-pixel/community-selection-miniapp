import { describe, expect, it } from 'vitest';
import { validateTimeWindows } from '../delivery/delivery-rule-service.js';
import { buildFulfillmentPromise } from './fulfillment-promise.js';

const capturedAt = new Date('2026-07-29T01:30:00.000Z');

describe('L53 fulfillment promise snapshots', () => {
  it('resolves a same-day delivery window against the Shanghai calendar', () => {
    const result = buildFulfillmentPromise({
      kind: 'delivery',
      capturedAt,
      window: {
        code: 'today_afternoon',
        label: '今日下午',
        start_time: '14:00',
        end_time: '18:00',
        day_offset: 0,
      },
      sourceRule: {
        id: 'delivery-rule-1',
        updated_at: new Date('2026-07-28T04:00:00.000Z'),
      },
    });

    expect(result.promised_fulfillment_start_at?.toISOString()).toBe(
      '2026-07-29T06:00:00.000Z',
    );
    expect(result.promised_fulfillment_end_at?.toISOString()).toBe(
      '2026-07-29T10:00:00.000Z',
    );
    expect(result.fulfillment_promise_snapshot).toEqual({
      schema_version: 1,
      fulfillment_type: 'delivery',
      window_code: 'today_afternoon',
      display_text: '今日下午 14:00-18:00',
      promised_start_at: '2026-07-29T06:00:00.000Z',
      promised_end_at: '2026-07-29T10:00:00.000Z',
      timezone: 'Asia/Shanghai',
      source: 'delivery_rule',
      source_rule_id: 'delivery-rule-1',
      source_rule_updated_at: '2026-07-28T04:00:00.000Z',
      captured_at: '2026-07-29T01:30:00.000Z',
    });
  });

  it('keeps historical tomorrow codes compatible without inventing a server timezone', () => {
    const result = buildFulfillmentPromise({
      kind: 'delivery',
      capturedAt,
      window: {
        code: 'tomorrow_morning',
        label: '明日上午',
        start_time: '09:00',
        end_time: '12:00',
      },
    });

    expect(result.promised_fulfillment_start_at?.toISOString()).toBe(
      '2026-07-30T01:00:00.000Z',
    );
    expect(result.promised_fulfillment_end_at?.toISOString()).toBe(
      '2026-07-30T04:00:00.000Z',
    );
  });

  it('copies the exact group-buy pickup time into the order snapshot', () => {
    const result = buildFulfillmentPromise({
      kind: 'group_buy_pickup',
      capturedAt,
      pickupTime: new Date('2026-07-31T02:30:00.000Z'),
    });

    expect(result.promised_fulfillment_start_at?.toISOString()).toBe(
      '2026-07-31T02:30:00.000Z',
    );
    expect(result.promised_fulfillment_end_at).toBeNull();
    expect(result.fulfillment_promise_snapshot).toMatchObject({
      fulfillment_type: 'store',
      display_text: '2026年7月31日 10:30 自提',
      promised_start_at: '2026-07-31T02:30:00.000Z',
      promised_end_at: null,
      timezone: 'Asia/Shanghai',
      source: 'group_buy_pickup',
    });
  });

  it('records an honest pending-confirmation snapshot for normal pickup', () => {
    const result = buildFulfillmentPromise({
      kind: 'normal_pickup',
      capturedAt,
    });

    expect(result.promised_fulfillment_start_at).toBeNull();
    expect(result.promised_fulfillment_end_at).toBeNull();
    expect(result.fulfillment_promise_snapshot).toMatchObject({
      fulfillment_type: 'store',
      display_text: '门店确认后通知自提时间',
      promised_start_at: null,
      promised_end_at: null,
      source: 'store_confirmation_pending',
    });
  });

  it.each([
    {
      code: 'overnight',
      label: '跨夜',
      start_time: '22:00',
      end_time: '02:00',
      day_offset: 0,
    },
    {
      code: 'invalid',
      label: '错误时间',
      start_time: '9:00',
      end_time: '12:00',
      day_offset: 0,
    },
  ])('rejects invalid or overnight delivery window $code', (window) => {
    expect(() =>
      buildFulfillmentPromise({
        kind: 'delivery',
        capturedAt,
        window,
      }),
    ).toThrow(/配送承诺时段/);
  });

  it('preserves explicit day offsets in editable delivery rules', () => {
    expect(
      validateTimeWindows([
        {
          code: 'day_after_tomorrow_morning',
          label: '后天上午',
          start_time: '09:00',
          end_time: '12:00',
          day_offset: 2,
        },
      ]),
    ).toEqual([
      {
        code: 'day_after_tomorrow_morning',
        label: '后天上午',
        start_time: '09:00',
        end_time: '12:00',
        day_offset: 2,
      },
    ]);

    expect(() =>
      validateTimeWindows([
        {
          code: 'invalid_offset',
          label: '错误日期',
          start_time: '09:00',
          end_time: '12:00',
          day_offset: -1,
        },
      ]),
    ).toThrow(/day_offset/);
  });
});
