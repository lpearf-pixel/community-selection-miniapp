import { describe, expect, it } from 'vitest';
import { applyMockRefundInTransaction } from './refund-service.js';

describe('refund transaction boundary', () => {
  it('exposes a caller-owned transaction entrypoint', () => {
    expect(typeof applyMockRefundInTransaction).toBe('function');
  });
});
