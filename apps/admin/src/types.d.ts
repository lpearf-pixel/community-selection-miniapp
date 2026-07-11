declare module 'react' {
  export type Key = string | number;
  export type ReactNode = unknown;
  export type ReactElement = unknown;
  export type CSSProperties = Record<string, string | number | undefined>;
  export type MouseEvent<T = Element> = { currentTarget: T; target: EventTarget | null };
  export type Ref<T> = ((instance: T | null) => void) | { current: T | null } | null;
  export interface RefAttributes<T> { ref?: Ref<T>; }
  export interface Attributes { key?: Key | null; }
  export interface HTMLAttributes<T> { className?: string; style?: CSSProperties; children?: ReactNode; onClick?: (event: MouseEvent<T>) => void; [key: string]: unknown; }
  export interface FunctionComponent<P = Record<string, unknown>> { (props: P): ReactElement | null; }
  export type FC<P = Record<string, unknown>> = FunctionComponent<P>;
  export interface ForwardRefExoticComponent<P = Record<string, unknown>> { (props: P): ReactElement | null; }
  export type ComponentType<P = Record<string, unknown>> = FunctionComponent<P> | ForwardRefExoticComponent<P>;
  export const StrictMode: FunctionComponent<{ children?: ReactNode }>;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void];
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): { render(node: unknown): void };
}

declare module 'react/jsx-runtime' {
  export namespace JSX {
    type Element = unknown;
    type ElementType = keyof IntrinsicElements | ((props: Record<string, unknown>) => Element | null) | { (props: Record<string, unknown>): Element | null };
    interface IntrinsicElements { [elemName: string]: Record<string, unknown>; }
  }
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export const Fragment: (props: { children?: unknown }) => JSX.Element;
}

declare namespace JSX {
  type Element = unknown;
  type ElementType = keyof IntrinsicElements | ((props: Record<string, unknown>) => Element | null) | { (props: Record<string, unknown>): Element | null };
  interface IntrinsicElements { [elemName: string]: Record<string, unknown>; }
}

declare module 'vite' {
  export function defineConfig(config: unknown): unknown;
}

interface ImportMeta {
  env?: {
    VITE_API_BASE_URL?: string;
  };
}
