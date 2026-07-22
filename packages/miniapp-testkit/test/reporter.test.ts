import { describe, expect, it } from 'vitest';
import { JsonLineReporter } from '../src/index.js';

describe('JsonLineReporter', () => {
  it('emits each progress event immediately as one JSON line', () => {
    const output: string[] = [];
    const reporter = new JsonLineReporter({
      runId: 'run-42',
      now: () => new Date('2026-07-21T12:00:00.000Z'),
      write: (line) => output.push(line),
    });

    reporter.step('product-ready', { productId: 'product-1' });

    expect(output).toEqual([
      '{"timestamp":"2026-07-21T12:00:00.000Z","runId":"run-42","event":"product-ready","details":{"productId":"product-1"}}\n',
    ]);
    expect(reporter.events()).toHaveLength(1);
  });

  it('creates deterministic artifact names for a run', () => {
    const reporter = new JsonLineReporter({
      runId: 'run-42',
      outputDir: '/tmp/e2e',
      write: () => undefined,
    });

    expect(reporter.artifactPath('failure', 'png')).toBe('/tmp/e2e/miniapp-e2e-run-42-failure.png');
    expect(reporter.artifactPath('report', 'json')).toBe('/tmp/e2e/miniapp-e2e-run-42-report.json');
  });
});
