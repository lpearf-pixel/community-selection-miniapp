declare module 'react' {
  type Component = (props: { children?: unknown; [key: string]: unknown }) => unknown;
  export const StrictMode: Component;
  export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: unknown[]): T;
  export function useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void];
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): { render(node: unknown): void };
}

declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
  export const Fragment: unknown;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: unknown;
  }
}

declare module 'vite' {
  export function defineConfig(config: unknown): unknown;
}


interface ImportMeta {
  env?: {
    VITE_API_BASE_URL?: string;
  };
}
