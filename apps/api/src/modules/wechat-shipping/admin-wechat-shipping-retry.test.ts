import { describe, expect, it } from 'vitest';
import {
  canRetryWechatShippingIntent,
  toAdminWechatShippingSummary,
} from './admin-wechat-shipping-retry.js';

describe('Admin WeChat shipping retry policy', () => {
  it('projects a safe non-sensitive status summary', () => {
    const summary = toAdminWechatShippingSummary({
      status: 'retryable',
      attempt_count: 2,
      last_error_code: 'WECHAT_SHIPPING_HTTP_503',
      next_retry_at: new Date('2026-07-29T12:02:00.000Z'),
      succeeded_at: null,
    });

    expect(summary).toEqual({
      status: 'retryable',
      attempts: 2,
      last_error_code: 'WECHAT_SHIPPING_HTTP_503',
      next_retry_at: new Date('2026-07-29T12:02:00.000Z'),
      succeeded_at: null,
    });
    expect(summary).not.toHaveProperty('transaction_id');
    expect(summary).not.toHaveProperty('openid');
    expect(summary).not.toHaveProperty('access_token');
  });

  it('marks orders without an intent as not applicable', () => {
    expect(toAdminWechatShippingSummary(null)).toEqual({
      status: 'not_applicable',
      attempts: 0,
      last_error_code: null,
      next_retry_at: null,
      succeeded_at: null,
    });
  });

  it.each([
    ['pending', false],
    ['processing', false],
    ['retryable', true],
    ['succeeded', false],
    ['manual_required', true],
  ] as const)('allows manual retry for %s: %s', (status, expected) => {
    expect(canRetryWechatShippingIntent(status)).toBe(expected);
  });
});
