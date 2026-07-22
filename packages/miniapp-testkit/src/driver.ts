import { InfrastructureError } from './errors.js';
import type {
  MiniProgramElement,
  MiniProgramPage,
  MiniProgramSession,
} from './ports.js';
import { withTimeout } from './policy.js';
import type { JsonLineReporter } from './reporter.js';

export interface ElementTarget {
  description: string;
  renderSelector: string;
  querySelector?: string;
  dataset?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}

export interface MiniappDriverOptions {
  session: MiniProgramSession;
  reporter: JsonLineReporter;
  operationTimeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function normalizeRoute(value: string): string {
  return String(value || '').replace(/^\/+/, '');
}

export class MiniappDriver {
  readonly session: MiniProgramSession;
  readonly reporter: JsonLineReporter;
  private readonly operationTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: MiniappDriverOptions) {
    this.session = options.session;
    this.reporter = options.reporter;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 10_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise<void>(
      (resolve) => setTimeout(resolve, milliseconds),
    ));
  }

  async waitForRoute(
    expected: string,
    options: { timeoutMs?: number } = {},
  ): Promise<MiniProgramPage> {
    const timeoutMs = options.timeoutMs ?? 20_000;
    const deadline = Date.now() + timeoutMs;
    let lastPath = '';
    this.reporter.step('route-wait-start', { expected: normalizeRoute(expected) });

    while (Date.now() <= deadline) {
      const page = await withTimeout(
        () => this.session.currentPage({ timeoutMs: this.operationTimeoutMs }),
        { label: `read current route for ${expected}`, timeoutMs: this.operationTimeoutMs },
      );
      lastPath = normalizeRoute(page.path);
      if (lastPath === normalizeRoute(expected)) {
        this.reporter.step('route-ready', { path: lastPath });
        return page;
      }
      await this.sleep(this.pollIntervalMs);
    }

    throw new InfrastructureError(
      `Timed out waiting for route ${normalizeRoute(expected)}; current route is ${lastPath || '<none>'}`,
      { code: 'ROUTE_TIMEOUT', retryable: false },
    );
  }

  async waitForElement(page: MiniProgramPage, target: ElementTarget): Promise<MiniProgramElement> {
    const timeoutMs = target.timeoutMs ?? 15_000;
    this.reporter.step('element-wait-start', {
      description: target.description,
      renderSelector: target.renderSelector,
      querySelector: target.querySelector ?? target.renderSelector,
      dataset: target.dataset,
    });

    await this.waitForRenderedTarget(page, target, timeoutMs);
    if (!page.query) {
      throw new InfrastructureError(`Page ${page.path} does not support element queries`, {
        code: 'QUERY_UNSUPPORTED',
      });
    }

    const deadline = Date.now() + timeoutMs;
    const selector = target.querySelector ?? target.renderSelector;
    while (Date.now() <= deadline) {
      const element = await withTimeout(
        () => page.query!(selector, { fallback: true, timeoutMs: this.operationTimeoutMs }),
        { label: `query ${target.description}`, timeoutMs: this.operationTimeoutMs },
      );
      if (element) {
        this.reporter.step('element-ready', { description: target.description, selector });
        return element;
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new InfrastructureError(`Timed out waiting for ${target.description} (${selector})`, {
      code: 'ELEMENT_TIMEOUT',
    });
  }

  private async waitForRenderedTarget(
    page: MiniProgramPage,
    target: ElementTarget,
    timeoutMs: number,
  ): Promise<void> {
    if (!page.waitForRendered) return;
    const renderTarget = {
      selector: target.renderSelector,
      ...(target.dataset ? { dataset: target.dataset } : {}),
    };
    await withTimeout(
      () => page.waitForRendered!(renderTarget, { timeoutMs }),
      { label: `wait for rendered ${target.description}`, timeoutMs },
    );
  }

  async invoke(
    page: MiniProgramPage,
    target: ElementTarget,
    method: string,
    ...args: unknown[]
  ): Promise<void> {
    const renderTimeoutMs = target.timeoutMs ?? 15_000;
    this.reporter.step('page-action-wait-start', {
      description: target.description,
      renderSelector: target.renderSelector,
      dataset: target.dataset,
      method,
    });
    await this.waitForRenderedTarget(page, target, renderTimeoutMs);
    if (!page.callMethod) {
      throw new InfrastructureError(`Page ${page.path} cannot invoke ${method}`, {
        code: 'PAGE_METHOD_UNSUPPORTED',
      });
    }
    this.reporter.step('page-action-start', { description: target.description, method });
    await withTimeout(
      () => page.callMethod!(method, ...args),
      {
        label: `invoke ${method} for ${target.description}`,
        timeoutMs: target.timeoutMs ?? this.operationTimeoutMs,
      },
    );
    this.reporter.step('page-action-complete', { description: target.description, method });
  }

  async waitForData<T>(
    page: MiniProgramPage,
    dataPath: string,
    predicate: (value: T) => boolean,
    options: { description: string; timeoutMs?: number },
  ): Promise<T> {
    if (!dataPath) throw new InfrastructureError('A named page data path is required', {
      code: 'DATA_PATH_REQUIRED',
    });
    if (!page.data) throw new InfrastructureError(`Page ${page.path} does not support data reads`, {
      code: 'DATA_UNSUPPORTED',
    });
    const timeoutMs = options.timeoutMs ?? 20_000;
    const deadline = Date.now() + timeoutMs;
    let lastValue: T | undefined;
    this.reporter.step('data-wait-start', {
      description: options.description,
      dataPath,
    });

    while (Date.now() <= deadline) {
      lastValue = await withTimeout(
        () => page.data!(dataPath, { fallback: true, timeoutMs: this.operationTimeoutMs }) as Promise<T>,
        { label: `read ${options.description}`, timeoutMs: this.operationTimeoutMs },
      );
      if (predicate(lastValue)) {
        this.reporter.step('data-ready', { description: options.description, dataPath });
        return lastValue;
      }
      await this.sleep(this.pollIntervalMs);
    }

    throw new InfrastructureError(
      `Timed out waiting for ${options.description} at data path ${dataPath}: ${JSON.stringify(lastValue)}`,
      { code: 'DATA_TIMEOUT' },
    );
  }

  async tap(page: MiniProgramPage, target: ElementTarget): Promise<void> {
    const element = await this.waitForElement(page, target);
    this.reporter.step('tap-start', { description: target.description });
    await withTimeout(
      () => element.tap(),
      { label: `tap ${target.description}`, timeoutMs: target.timeoutMs ?? this.operationTimeoutMs },
    );
    this.reporter.step('tap-complete', { description: target.description });
  }

  async input(page: MiniProgramPage, target: ElementTarget, value: string): Promise<void> {
    const element = await this.waitForElement(page, target);
    if (!element.input) throw new InfrastructureError(`${target.description} is not an input element`, {
      code: 'INPUT_UNSUPPORTED',
    });
    this.reporter.step('input-start', { description: target.description });
    await withTimeout(
      () => element.input!(value),
      { label: `input ${target.description}`, timeoutMs: target.timeoutMs ?? this.operationTimeoutMs },
    );
    this.reporter.step('input-complete', { description: target.description });
  }

  async trigger(
    page: MiniProgramPage,
    target: ElementTarget,
    eventName: string,
    detail?: unknown,
  ): Promise<void> {
    const element = await this.waitForElement(page, target);
    if (!element.trigger) throw new InfrastructureError(`${target.description} cannot dispatch events`, {
      code: 'TRIGGER_UNSUPPORTED',
    });
    this.reporter.step('trigger-start', { description: target.description, eventName });
    await withTimeout(
      () => element.trigger!(eventName, detail),
      { label: `trigger ${eventName} on ${target.description}`, timeoutMs: target.timeoutMs ?? this.operationTimeoutMs },
    );
    this.reporter.step('trigger-complete', { description: target.description, eventName });
  }
}
