import { Launcher } from '@weapp-vite/miniprogram-automator';
import type {
  ElementQueryOptions,
  MiniProgramElement,
  MiniProgramPage,
  MiniProgramSession,
  RenderedTarget,
} from './ports.js';

interface RawElement {
  tap(): Promise<void>;
  input?(value: string): Promise<void>;
  trigger?(eventName: string, detail?: unknown): Promise<void>;
  attribute?(name: string): Promise<unknown>;
  text?(): Promise<unknown>;
}

interface RawPage {
  path: string;
  $(selector: string, options?: { fallback?: boolean; timeout?: number }): Promise<RawElement | null>;
  waitForRendered?(options: {
    selector: string;
    dataset?: Record<string, string | number | boolean>;
    timeout?: number;
  }): Promise<unknown>;
  data?(path?: string, options?: { fallback?: boolean; timeout?: number }): Promise<unknown>;
  wxml?(): Promise<string>;
  callMethod?(method: string, ...args: unknown[]): Promise<unknown>;
  callMethodWithOptions?(
    method: string,
    options?: { fallback?: boolean; timeout?: number },
    ...args: unknown[]
  ): Promise<unknown>;
}

interface RawSession {
  waitForAppReady?(timeout?: number): Promise<void>;
  currentPage(options?: { timeout?: number }): Promise<RawPage>;
  reLaunch(url: string): Promise<RawPage>;
  callWxMethod(method: string, ...args: unknown[]): Promise<unknown>;
  evaluate?(expression: string, ...args: unknown[]): Promise<unknown>;
  evaluateWithOptions?(
    expression: string,
    options?: { timeout?: number },
    ...args: unknown[]
  ): Promise<unknown>;
  screenshot(options?: { path?: string; timeout?: number }): Promise<unknown>;
  close(): Promise<void>;
  disconnect(): void;
}

interface LauncherPort {
  connect(options: Record<string, unknown>): Promise<unknown>;
  launch(options: Record<string, unknown>): Promise<unknown>;
}

export interface WechatSessionFactoryOptions {
  createLauncher?: () => LauncherPort;
}

export interface WechatConnectOptions {
  wsEndpoint: string;
  timeoutMs: number;
}

export interface WechatLaunchOptions {
  cliPath: string;
  projectPath: string;
  port: number;
  timeoutMs: number;
}

function adaptElement(element: RawElement): MiniProgramElement {
  return {
    tap: () => element.tap(),
    ...(element.input ? { input: (value: string) => element.input!(value) } : {}),
    ...(element.trigger ? {
      trigger: (eventName: string, detail?: unknown) => element.trigger!(eventName, detail),
    } : {}),
    ...(element.attribute ? { attribute: (name: string) => element.attribute!(name) } : {}),
    ...(element.text ? { text: () => element.text!() } : {}),
  };
}

function adaptPage(page: RawPage): MiniProgramPage {
  return {
    path: page.path,
    query: async (selector: string, options: ElementQueryOptions = {}) => {
      const element = await page.$(selector, {
        fallback: options.fallback,
        timeout: options.timeoutMs,
      });
      return element ? adaptElement(element) : null;
    },
    ...(page.waitForRendered ? {
      waitForRendered: (target: RenderedTarget, options: { timeoutMs?: number } = {}) => (
        page.waitForRendered!({
          selector: target.selector,
          ...(target.dataset ? { dataset: target.dataset } : {}),
          timeout: options.timeoutMs,
        })
      ),
    } : {}),
    ...(page.data ? {
      data: (dataPath?: string, options: { fallback?: boolean; timeoutMs?: number } = {}) => (
        page.data!(dataPath, { fallback: options.fallback, timeout: options.timeoutMs })
      ),
    } : {}),
    ...(page.wxml ? { wxml: () => page.wxml!() } : {}),
    ...(page.callMethodWithOptions || page.callMethod ? {
      callMethod: (method: string, ...args: unknown[]) => page.callMethodWithOptions
        ? page.callMethodWithOptions(method, { fallback: true }, ...args)
        : page.callMethod!(method, ...args),
    } : {}),
  };
}

function adaptSession(session: RawSession): MiniProgramSession {
  return {
    currentPage: async (options = {}) => adaptPage(await session.currentPage({
      timeout: options.timeoutMs,
    })),
    reLaunch: async (url) => adaptPage(await session.reLaunch(url)),
    callWxMethod: (method, ...args) => session.callWxMethod(method, ...args),
    ...(session.evaluateWithOptions || session.evaluate ? {
      evaluate: (expression: string, options: { timeoutMs?: number } = {}) => (
        session.evaluateWithOptions
          ? session.evaluateWithOptions(expression, { timeout: options.timeoutMs })
          : session.evaluate!(expression)
      ),
    } : {}),
    screenshot: (options = {}) => session.screenshot({
      path: options.path,
      timeout: options.timeoutMs,
    }),
    close: () => session.close(),
    disconnect: () => session.disconnect(),
    ...(session.waitForAppReady ? {
      waitForAppReady: (timeoutMs?: number) => session.waitForAppReady!(timeoutMs),
    } : {}),
  };
}

export class WechatSessionFactory {
  private readonly createLauncher: () => LauncherPort;

  constructor(options: WechatSessionFactoryOptions = {}) {
    this.createLauncher = options.createLauncher
      ?? (() => new Launcher() as unknown as LauncherPort);
  }

  async connect(options: WechatConnectOptions): Promise<MiniProgramSession> {
    const raw = await this.createLauncher().connect({
      platform: 'wechat',
      wsEndpoint: options.wsEndpoint,
      timeout: options.timeoutMs,
    }) as RawSession;
    await raw.waitForAppReady?.(options.timeoutMs);
    return adaptSession(raw);
  }

  async launch(options: WechatLaunchOptions): Promise<MiniProgramSession> {
    const raw = await this.createLauncher().launch({
      platform: 'wechat',
      cliPath: options.cliPath,
      projectPath: options.projectPath,
      port: options.port,
      timeout: options.timeoutMs,
      trustProject: true,
    }) as RawSession;
    await raw.waitForAppReady?.(options.timeoutMs);
    return adaptSession(raw);
  }
}
