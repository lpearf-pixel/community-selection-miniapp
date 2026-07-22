import { describe, expect, it } from 'vitest';
import { runScenarioLifecycle } from '../src/index.js';

describe('scenario lifecycle', () => {
  it('runs cleanup in reverse registration order', async () => {
    const calls: string[] = [];
    await runScenarioLifecycle({
      run: async () => calls.push('run'),
      cleanups: [
        async () => calls.push('first'),
        async () => calls.push('second'),
      ],
    });
    expect(calls).toEqual(['run', 'second', 'first']);
  });

  it('preserves the primary scenario error and attaches cleanup diagnostics', async () => {
    const primary = new Error('checkout assertion failed');
    let received: unknown;
    try {
      await runScenarioLifecycle({
        run: async () => { throw primary; },
        cleanups: [async () => { throw new Error('storage restore failed'); }],
      });
    } catch (error) {
      received = error;
    }

    expect(received).toBe(primary);
    expect((received as Error & { cleanupErrors: Error[] }).cleanupErrors)
      .toEqual([expect.objectContaining({ message: 'storage restore failed' })]);
  });

  it('fails on cleanup when the scenario body succeeded', async () => {
    await expect(runScenarioLifecycle({
      run: async () => undefined,
      cleanups: [async () => { throw new Error('close failed'); }],
    })).rejects.toThrow('Scenario cleanup failed: close failed');
  });
});
