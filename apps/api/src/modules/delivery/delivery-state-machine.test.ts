import { describe, expect, it } from 'vitest';
import {
  allowedNextDeliveryStatuses,
  validateDeliveryTransition,
} from './delivery-state-machine.js';

describe('L53-B delivery fulfillment state machine', () => {
  it.each([
    ['pending_dispatch', ['delivering', 'exception']],
    ['delivering', ['delivered', 'exception']],
    ['exception', ['pending_dispatch', 'delivering']],
    ['delivered', []],
  ] as const)('exposes allowed transitions from %s', (current, expected) => {
    expect(allowedNextDeliveryStatuses(current)).toEqual(expected);
  });

  it.each([
    ['pending_dispatch', 'delivering'],
    ['pending_dispatch', 'exception'],
    ['delivering', 'delivered'],
    ['delivering', 'exception'],
    ['exception', 'pending_dispatch'],
    ['exception', 'delivering'],
  ] as const)('accepts %s -> %s', (current, next) => {
    expect(() =>
      validateDeliveryTransition({
        current,
        next,
        remark: next === 'exception' ? '联系不上收货人' : undefined,
      }),
    ).not.toThrow();
  });

  it.each([
    ['pending_dispatch', 'delivered'],
    ['delivering', 'pending_dispatch'],
    ['delivered', 'exception'],
    ['delivered', 'delivering'],
    ['exception', 'delivered'],
  ] as const)('rejects unsupported transition %s -> %s', (current, next) => {
    expect(() =>
      validateDeliveryTransition({
        current,
        next,
        remark: '测试备注',
      }),
    ).toThrow(/配送状态不可从/);
  });

  it.each([undefined, '', '   '])(
    'requires a meaningful exception remark: %s',
    (remark) => {
      expect(() =>
        validateDeliveryTransition({
          current: 'delivering',
          next: 'exception',
          remark,
        }),
      ).toThrow(/异常原因/);
    },
  );
});
