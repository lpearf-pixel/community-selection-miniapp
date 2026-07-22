import { describe, expect, it, vi } from 'vitest';
import {
  BusinessAssertionError,
  InfrastructureError,
  retryInfrastructure,
  withTimeout,
} from '../src/index.js';

describe('operation policy', () => {
  it('times out a stalled protocol operation with its step name', async () => {
    await expect(
      withTimeout(() => new Promise<never>(() => undefined), {
        label: 'read current page',
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      name: 'InfrastructureError',
      code: 'OPERATION_TIMEOUT',
      message: 'Timed out after 10 ms during read current page',
    });
  });

  it('retries retryable infrastructure reads up to the configured bound', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new InfrastructureError('socket closed', { retryable: true }))
      .mockRejectedValueOnce(new InfrastructureError('protocol busy', { retryable: true }))
      .mockResolvedValue('ready');

    await expect(retryInfrastructure(operation, {
      attempts: 3,
      delayMs: 0,
      label: 'automation probe',
    })).resolves.toBe('ready');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry business assertions', async () => {
    const operation = vi.fn(async () => {
      throw new BusinessAssertionError('order did not become paid');
    });

    await expect(retryInfrastructure(operation, {
      attempts: 3,
      delayMs: 0,
      label: 'paid assertion',
    })).rejects.toThrow('order did not become paid');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
