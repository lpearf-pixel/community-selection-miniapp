import { describe, expect, it } from 'vitest';
import { AdminApiError } from '../api/errors';
import { settleLatestFeatureRequest } from './latest-feature-request';

function ticket(currentGeneration: () => number, generation = 1) {
  const controller = new AbortController();
  return {
    controller,
    generation,
    isCurrent: () =>
      !controller.signal.aborted &&
      currentGeneration() === generation,
  };
}

describe('settleLatestFeatureRequest', () => {
  it('resolves data for the current request', async () => {
    let currentGeneration = 1;
    const request = ticket(() => currentGeneration);

    await expect(
      settleLatestFeatureRequest(request, async () => ['current']),
    ).resolves.toEqual({ discarded: false, data: ['current'] });
  });

  it('discards an out-of-order response after a newer generation starts', async () => {
    let currentGeneration = 1;
    const request = ticket(() => currentGeneration);
    let resolveRequest!: (value: string[]) => void;
    const pending = new Promise<string[]>((resolve) => {
      resolveRequest = resolve;
    });
    const result = settleLatestFeatureRequest(request, () => pending);

    currentGeneration = 2;
    resolveRequest(['stale']);

    await expect(result).resolves.toEqual({ discarded: true });
  });

  it('settles an aborted request without leaking its rejection', async () => {
    let currentGeneration = 1;
    const request = ticket(() => currentGeneration);
    const result = settleLatestFeatureRequest(request, (signal) =>
      new Promise<string[]>((_, reject) => {
        signal.addEventListener(
          'abort',
          () =>
            reject(
              new AdminApiError(
                '请求已取消',
                0,
                'REQUEST_ABORTED',
              ),
            ),
          { once: true },
        );
      }),
    );

    currentGeneration = 2;
    request.controller.abort();

    await expect(result).resolves.toEqual({ discarded: true });
  });

  it('rethrows a current non-abort failure', async () => {
    let currentGeneration = 1;
    const request = ticket(() => currentGeneration);
    const failure = new AdminApiError('网络请求失败', 0, 'NETWORK_ERROR');

    await expect(
      settleLatestFeatureRequest(request, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
