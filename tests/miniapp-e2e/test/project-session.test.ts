import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  JsonLineReporter,
  type MiniProgramPage,
  type MiniProgramSession,
} from '@community-selection/miniapp-testkit';
import {
  captureProjectFailure,
  probeSourceContract,
  writeProjectReport,
} from '../src/project-session.js';

const created: string[] = [];

afterEach(() => {
  for (const file of created.splice(0)) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

function session(overrides: Partial<MiniProgramSession> = {}): MiniProgramSession {
  const page: MiniProgramPage = {
    path: 'pages/index/index',
    wxml: vi.fn(async () => '<view id="root" />'),
  };
  return {
    currentPage: vi.fn(async () => page),
    reLaunch: vi.fn(async () => page),
    callWxMethod: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => 'miniapp-e2e-v2'),
    screenshot: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    ...overrides,
  };
}

describe('project session safeguards', () => {
  it('accepts the current source contract and rejects a cached older build', async () => {
    await expect(probeSourceContract(session(), 50)).resolves.toBeUndefined();
    await expect(probeSourceContract(session({
      evaluate: vi.fn(async () => 'miniapp-e2e-v1'),
    }), 50)).rejects.toMatchObject({
      code: 'MINIAPP_SOURCE_CONTRACT_MISMATCH',
    });
  });

  it('captures route, WXML, and screenshot without requesting full page data', async () => {
    const data = vi.fn(async () => { throw new Error('must not read page data'); });
    const page: MiniProgramPage = {
      path: 'pages/products/index',
      data,
      wxml: vi.fn(async () => '<view class="products" />'),
    };
    const screenshot = vi.fn(async () => undefined);
    const reporter = new JsonLineReporter({
      runId: 'evidence',
      outputDir: '/tmp',
      write: () => undefined,
    });

    await captureProjectFailure(session({
      currentPage: vi.fn(async () => page),
      screenshot,
    }), reporter, 50);

    expect(data).not.toHaveBeenCalled();
    expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({
      path: '/tmp/miniapp-e2e-evidence-failure.png',
    }));
    expect(reporter.events().map((event) => event.event)).toEqual([
      'failure-page',
      'failure-screenshot',
    ]);
  });

  it('writes one machine-readable report for the complete run', () => {
    const reporter = new JsonLineReporter({
      runId: 'report-test',
      outputDir: '/tmp',
      write: () => undefined,
    });
    reporter.step('suite-start');
    const target = writeProjectReport(reporter);
    created.push(target);

    expect(target).toBe('/tmp/miniapp-e2e-report-test-report.json');
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toMatchObject({
      runId: 'report-test',
      events: [{ event: 'suite-start' }],
    });
  });
});
