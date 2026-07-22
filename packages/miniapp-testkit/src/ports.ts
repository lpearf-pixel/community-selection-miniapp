export interface RenderedTarget {
  selector: string;
  dataset?: Record<string, string | number | boolean>;
}

export interface ElementQueryOptions {
  fallback?: boolean;
  timeoutMs?: number;
}

export interface MiniProgramElement {
  tap(): Promise<void>;
  input?(value: string): Promise<void>;
  trigger?(eventName: string, detail?: unknown): Promise<void>;
  attribute?(name: string): Promise<unknown>;
  text?(): Promise<unknown>;
}

export interface MiniProgramPage {
  path: string;
  query?(selector: string, options?: ElementQueryOptions): Promise<MiniProgramElement | null>;
  waitForRendered?(target: RenderedTarget, options?: { timeoutMs?: number }): Promise<unknown>;
  data?(path?: string, options?: { fallback?: boolean; timeoutMs?: number }): Promise<unknown>;
  wxml?(): Promise<string>;
  callMethod?(method: string, ...args: unknown[]): Promise<unknown>;
}

export interface MiniProgramSession {
  currentPage(options?: { timeoutMs?: number }): Promise<MiniProgramPage>;
  reLaunch(url: string): Promise<MiniProgramPage>;
  callWxMethod(method: string, ...args: unknown[]): Promise<unknown>;
  evaluate?(expression: string, options?: { timeoutMs?: number }): Promise<unknown>;
  screenshot(options?: { path?: string; timeoutMs?: number }): Promise<unknown>;
  close(): Promise<void>;
  disconnect(): void;
  waitForAppReady?(timeoutMs?: number): Promise<void>;
}
