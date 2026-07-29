import { describe, expect, it } from 'vitest';
import {
  resolveDeliveryShippingIntent,
  resolvePickupShippingIntent,
} from './wechat-shipping-intent.js';

describe('WeChat shipping intent policy', () => {
  it.each([
    ['pending_dispatch', 'delivering'],
    ['exception', 'delivering'],
  ] as const)(
    'creates the one delivery-started intent for %s -> %s',
    (current, next) => {
      expect(resolveDeliveryShippingIntent(current, next)).toEqual({
        trigger: 'delivery_started',
        logisticsType: 2,
      });
    },
  );

  it.each([
    ['pending_dispatch', 'exception'],
    ['exception', 'pending_dispatch'],
    ['delivering', 'delivered'],
    ['delivering', 'exception'],
  ] as const)(
    'does not create a shipping intent for %s -> %s',
    (current, next) => {
      expect(resolveDeliveryShippingIntent(current, next)).toBeNull();
    },
  );

  it('maps a successful pickup verification to user pickup', () => {
    expect(resolvePickupShippingIntent()).toEqual({
      trigger: 'pickup_verified',
      logisticsType: 4,
    });
  });
});
