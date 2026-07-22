import { describe, expect, it, vi } from 'vitest';
import {
  JsonLineReporter,
  MiniappDriver,
  type MiniProgramElement,
  type MiniProgramPage,
  type MiniProgramSession,
} from '../src/index.js';

function sessionWithPage(page: MiniProgramPage): MiniProgramSession {
  return {
    currentPage: vi.fn(async () => page),
    reLaunch: vi.fn(async () => page),
    callWxMethod: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(),
  };
}

describe('MiniappDriver', () => {
  it('waits for a normalized route through bounded infrastructure reads', async () => {
    const page: MiniProgramPage = { path: '/pages/products/index' };
    const driver = new MiniappDriver({
      session: sessionWithPage(page),
      reporter: new JsonLineReporter({ write: () => undefined, runId: 'route' }),
      pollIntervalMs: 0,
    });

    await expect(driver.waitForRoute('pages/products/index', { timeoutMs: 50 })).resolves.toBe(page);
  });

  it('waits for rendered dataset evidence and queries a single stable id', async () => {
    const element: MiniProgramElement = { tap: vi.fn(async () => undefined) };
    const page: MiniProgramPage = {
      path: 'pages/products/index',
      waitForRendered: vi.fn(async (target) => {
        expect(target).toEqual({
          selector: '[data-testid="product-normal-buy"]',
          dataset: { id: 'product-1' },
        });
      }),
      query: vi.fn(async (selector) => selector === '#product-normal-buy-product-1' ? element : null),
    };
    const driver = new MiniappDriver({
      session: sessionWithPage(page),
      reporter: new JsonLineReporter({ write: () => undefined, runId: 'element' }),
      pollIntervalMs: 0,
    });

    await expect(driver.waitForElement(page, {
      description: 'selected product buy button',
      renderSelector: '[data-testid="product-normal-buy"]',
      querySelector: '#product-normal-buy-product-1',
      dataset: { id: 'product-1' },
      timeoutMs: 50,
    })).resolves.toBe(element);
    expect(page.query).toHaveBeenCalledWith('#product-normal-buy-product-1', expect.objectContaining({
      fallback: true,
    }));
  });

  it('never retries a tap whose completion is ambiguous', async () => {
    const tap = vi.fn(async () => {
      throw new Error('protocol disconnected after tap');
    });
    const page: MiniProgramPage = {
      path: 'pages/products/index',
      waitForRendered: vi.fn(async () => undefined),
      query: vi.fn(async () => ({ tap })),
    };
    const driver = new MiniappDriver({
      session: sessionWithPage(page),
      reporter: new JsonLineReporter({ write: () => undefined, runId: 'tap' }),
      pollIntervalMs: 0,
    });

    await expect(driver.tap(page, {
      description: 'direct buy',
      renderSelector: '[data-testid="product-normal-buy"]',
      querySelector: '#product-normal-buy-product-1',
      dataset: { id: 'product-1' },
      timeoutMs: 50,
    })).rejects.toThrow('protocol disconnected after tap');
    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('waits on a named data path and never requests full page data', async () => {
    const data = vi
      .fn<(path?: string, options?: { fallback?: boolean; timeoutMs?: number }) => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'order-1', pay_status: 'paid' });
    const page: MiniProgramPage = {
      path: 'pages/orders/detail/index',
      data,
    };
    const driver = new MiniappDriver({
      session: sessionWithPage(page),
      reporter: new JsonLineReporter({ write: () => undefined, runId: 'data' }),
      pollIntervalMs: 0,
    });

    await expect(driver.waitForData(
      page,
      'order',
      (value) => Boolean(value && (value as { pay_status?: string }).pay_status === 'paid'),
      { description: 'paid order', timeoutMs: 50 },
    )).resolves.toEqual({ id: 'order-1', pay_status: 'paid' });
    expect(data).toHaveBeenCalledTimes(2);
    expect(data).toHaveBeenNthCalledWith(1, 'order', expect.objectContaining({ fallback: true }));
    expect(data).not.toHaveBeenCalledWith(undefined, expect.anything());
  });

  it('dispatches a picker change once without replaying it', async () => {
    const trigger = vi.fn(async () => undefined);
    const page: MiniProgramPage = {
      path: 'pages/form/index',
      waitForRendered: vi.fn(async () => undefined),
      query: vi.fn(async () => ({
        tap: vi.fn(async () => undefined),
        trigger,
      })),
    };
    const driver = new MiniappDriver({
      session: sessionWithPage(page),
      reporter: new JsonLineReporter({ write: () => undefined, runId: 'trigger' }),
      pollIntervalMs: 0,
    });

    await driver.trigger(page, {
      description: 'fixture picker',
      renderSelector: '[data-testid="fixture-picker"]',
      timeoutMs: 50,
    }, 'change', { value: '2' });

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('change', { value: '2' });
  });

  it('invokes a rendered page action without querying a fallback element', async () => {
    const callMethod = vi.fn(async () => undefined);
    const query = vi.fn(async () => null);
    const waitForRendered = vi.fn(async () => undefined);
    const page: MiniProgramPage = {
      path: 'pages/form/index',
      waitForRendered,
      query,
      callMethod,
    };
    const driver = new MiniappDriver({
      session: sessionWithPage(page),
      reporter: new JsonLineReporter({ write: () => undefined, runId: 'page-action' }),
      pollIntervalMs: 0,
    });

    await driver.invoke(page, {
      description: 'fixture picker',
      renderSelector: '.e2e-fixture-picker',
      dataset: { id: 'fixture-1' },
      timeoutMs: 50,
    }, 'onFixtureChange', { detail: { value: '2' } });

    expect(waitForRendered).toHaveBeenCalledWith({
      selector: '.e2e-fixture-picker',
      dataset: { id: 'fixture-1' },
    }, { timeoutMs: 50 });
    expect(callMethod).toHaveBeenCalledTimes(1);
    expect(callMethod).toHaveBeenCalledWith('onFixtureChange', { detail: { value: '2' } });
    expect(query).not.toHaveBeenCalled();
  });
});
