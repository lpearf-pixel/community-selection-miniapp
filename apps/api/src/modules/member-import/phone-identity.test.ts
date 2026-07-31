import { describe, expect, it } from 'vitest';
import {
  fingerprintPhone,
  maskPhone,
  normalizeMainlandPhone,
} from './phone-identity.js';

describe('legacy member phone identity', () => {
  it.each([
    ['13800138000', '13800138000'],
    ['+86 138-0013-8000', '13800138000'],
    ['86 138 0013 8000', '13800138000'],
  ])('normalizes supported mainland phone form %s', (raw, expected) => {
    expect(normalizeMainlandPhone(raw)).toBe(expected);
  });

  it.each(['', '12800138000', '1380013800', '138001380000', '+1 13800138000']) (
    'rejects invalid phone %s',
    (raw) => expect(normalizeMainlandPhone(raw)).toBeNull(),
  );

  it('masks the normalized value without revealing the middle digits', () => {
    expect(maskPhone('13800138000')).toBe('138****8000');
  });

  it('creates deterministic key-separated fingerprints', () => {
    const secretA = 'a'.repeat(32);
    const secretB = 'b'.repeat(32);
    expect(fingerprintPhone('13800138000', secretA)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintPhone('13800138000', secretA)).toBe(
      fingerprintPhone('13800138000', secretA),
    );
    expect(fingerprintPhone('13800138000', secretA)).not.toBe(
      fingerprintPhone('13800138000', secretB),
    );
  });

  it('fails closed for a weak identity secret', () => {
    expect(() => fingerprintPhone('13800138000', 'short')).toThrow(
      'MEMBER_PHONE_HMAC_SECRET',
    );
  });
});
