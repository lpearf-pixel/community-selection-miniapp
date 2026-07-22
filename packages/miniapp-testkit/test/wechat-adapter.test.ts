import { describe, expect, it, vi } from 'vitest';
import { WechatSessionFactory } from '../src/index.js';

function createRawSession() {
  const rawElement = {
    tap: vi.fn(async () => undefined),
    input: vi.fn(async () => undefined),
    trigger: vi.fn(async () => undefined),
    attribute: vi.fn(async () => 'value'),
    text: vi.fn(async () => 'button'),
  };
  const rawPage = {
    path: 'pages/index/index',
    $: vi.fn(async () => rawElement),
    waitForRendered: vi.fn(async () => undefined),
    data: vi.fn(async () => ({ ready: true })),
    wxml: vi.fn(async () => '<view />'),
    callMethodWithOptions: vi.fn(async () => undefined),
  };
  const rawSession = {
    waitForAppReady: vi.fn(async () => undefined),
    currentPage: vi.fn(async () => rawPage),
    reLaunch: vi.fn(async () => rawPage),
    callWxMethod: vi.fn(async () => undefined),
    evaluateWithOptions: vi.fn(async () => 'contract-v1'),
    screenshot: vi.fn(async () => '/tmp/capture.png'),
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(),
  };
  return { rawElement, rawPage, rawSession };
}

describe('WechatSessionFactory', () => {
  it('connects with an explicit timeout and waits for App readiness', async () => {
    const { rawPage, rawSession } = createRawSession();
    const launcher = {
      connect: vi.fn(async () => rawSession),
      launch: vi.fn(async () => rawSession),
    };
    const factory = new WechatSessionFactory({ createLauncher: () => launcher });

    const session = await factory.connect({
      wsEndpoint: 'ws://127.0.0.1:9420',
      timeoutMs: 12_000,
    });
    const page = await session.currentPage({ timeoutMs: 3_000 });
    await page.waitForRendered?.(
      { selector: '[data-testid="submit"]', dataset: { id: 'fixture-1' } },
      { timeoutMs: 2_000 },
    );
    await page.query?.('#submit-fixture-1', { fallback: true, timeoutMs: 1_000 });
    await expect(session.evaluate?.('getApp().globalData.contract', { timeoutMs: 1_500 }))
      .resolves.toBe('contract-v1');

    expect(launcher.connect).toHaveBeenCalledWith({
      platform: 'wechat',
      wsEndpoint: 'ws://127.0.0.1:9420',
      timeout: 12_000,
    });
    expect(rawSession.waitForAppReady).toHaveBeenCalledWith(12_000);
    expect(rawSession.currentPage).toHaveBeenCalledWith({ timeout: 3_000 });
    expect(rawPage.waitForRendered).toHaveBeenCalledWith({
      selector: '[data-testid="submit"]',
      dataset: { id: 'fixture-1' },
      timeout: 2_000,
    });
    expect(rawPage.$).toHaveBeenCalledWith('#submit-fixture-1', {
      fallback: true,
      timeout: 1_000,
    });
    expect(rawSession.evaluateWithOptions).toHaveBeenCalledWith(
      'function () { return (getApp().globalData.contract); }',
      { timeout: 1_500 },
    );
  });

  it('launches a trusted project with the requested CLI and port', async () => {
    const { rawSession } = createRawSession();
    const launcher = {
      connect: vi.fn(async () => rawSession),
      launch: vi.fn(async () => rawSession),
    };
    const factory = new WechatSessionFactory({ createLauncher: () => launcher });

    await factory.launch({
      cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      projectPath: '/project/apps/miniapp',
      port: 9420,
      timeoutMs: 60_000,
    });

    expect(launcher.launch).toHaveBeenCalledWith({
      platform: 'wechat',
      cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      projectPath: '/project/apps/miniapp',
      port: 9420,
      timeout: 60_000,
      trustProject: true,
    });
    expect(rawSession.waitForAppReady).toHaveBeenCalledWith(60_000);
  });

  it('wraps expressions for the legacy evaluate fallback too', async () => {
    const { rawSession } = createRawSession();
    const rawEvaluate = vi.fn(async () => 'contract-v1');
    const { evaluateWithOptions: _evaluateWithOptions, ...rawWithoutOptions } = rawSession;
    const fallbackSession = { ...rawWithoutOptions, evaluate: rawEvaluate };
    const launcher = {
      connect: vi.fn(async () => fallbackSession),
      launch: vi.fn(async () => fallbackSession),
    };
    const factory = new WechatSessionFactory({ createLauncher: () => launcher });
    const session = await factory.connect({
      wsEndpoint: 'ws://127.0.0.1:9420',
      timeoutMs: 12_000,
    });

    await expect(session.evaluate?.('getApp().globalData.contract', { timeoutMs: 1_500 }))
      .resolves.toBe('contract-v1');
    expect(rawEvaluate).toHaveBeenCalledWith(
      'function () { return (getApp().globalData.contract); }',
    );
  });
});
