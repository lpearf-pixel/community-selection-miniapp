import { describe, expect, it } from 'vitest';
import {
  isPrismaRetryableConflict,
  isPrismaSerializationConflict,
  isPrismaUniqueConflict,
} from './prisma-conflict.js';

describe('Prisma membership conflict classification', () => {
  it('recognizes native and raw-query serialization conflicts', () => {
    expect(isPrismaSerializationConflict({ code: 'P2034' })).toBe(true);
    expect(isPrismaSerializationConflict({ code: 'P2010', meta: { code: '40001' } })).toBe(true);
  });

  it('keeps unique conflicts distinct while allowing bounded command retries', () => {
    expect(isPrismaUniqueConflict({ code: 'P2002' })).toBe(true);
    expect(isPrismaRetryableConflict({ code: 'P2002' })).toBe(true);
    expect(isPrismaRetryableConflict({ code: 'P2010', meta: { code: '23514' } })).toBe(false);
    expect(isPrismaRetryableConflict(new Error('40001'))).toBe(false);
  });
});
