import { describe, expect, it, vi } from 'vitest';
import {
  consumerVerifierHeaders,
  enableConsumerVerifierMockIdentity,
  injectAsConsumer,
} from './consumer-verifier-request.js';

describe('consumer verifier request boundary', () => {
  it('enables mock identity only outside production', () => {
    const testEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test' };
    enableConsumerVerifierMockIdentity(testEnv);
    expect(testEnv.CURRENT_USER_MOCK_HEADERS_ENABLED).toBe('true');

    expect(() =>
      enableConsumerVerifierMockIdentity({ NODE_ENV: 'production' }),
    ).toThrow('production');
  });

  it('rejects a missing user id before request injection', async () => {
    const inject = vi.fn();

    await expect(
      injectAsConsumer({ inject }, '   ', {
        method: 'POST',
        url: '/api/orders',
        payload: { quantity: 1 },
      }),
    ).rejects.toThrow('test user id');
    expect(inject).not.toHaveBeenCalled();
  });

  it('builds trusted consumer headers for external verifier requests', () => {
    expect(
      consumerVerifierHeaders(' user-a ', {
        'x-trace-id': 'trace-a',
        'x-user-id': 'forged-user',
        'x-openid': 'forged-openid',
      }),
    ).toEqual({
      'x-trace-id': 'trace-a',
      'x-user-id': 'user-a',
    });

    expect(() => consumerVerifierHeaders('   ')).toThrow('test user id');
  });

  it('moves identity to a trusted header and strips body identity', async () => {
    const response = { statusCode: 201 };
    const inject = vi.fn(async () => response);

    await expect(
      injectAsConsumer({ inject }, ' user-a ', {
        method: 'POST',
        url: '/api/orders/normal',
        headers: { 'x-trace-id': 'trace-a', 'x-user-id': 'forged-user' },
        payload: {
          product_id: 'product-a',
          quantity: 2,
          user_id: 'forged-user',
          user_openid: 'forged-openid',
        },
      }),
    ).resolves.toBe(response);

    expect(inject).toHaveBeenCalledWith({
      method: 'POST',
      url: '/api/orders/normal',
      headers: {
        'x-trace-id': 'trace-a',
        'x-user-id': 'user-a',
      },
      payload: {
        product_id: 'product-a',
        quantity: 2,
      },
    });
  });
});

