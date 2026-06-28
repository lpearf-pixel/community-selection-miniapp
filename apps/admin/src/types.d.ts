declare module 'react' {
  type Component = (props: { children?: unknown }) => unknown;
  export const StrictMode: Component;
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): { render(node: unknown): void };
}


declare module 'react/jsx-runtime' {
  export function jsx(type: unknown, props: unknown, key?: unknown): unknown;
  export function jsxs(type: unknown, props: unknown, key?: unknown): unknown;
  export const Fragment: unknown;
}

declare module 'antd' {
  type Component = (props: { children?: unknown; [key: string]: unknown }) => unknown;
  export const Card: Component;
  export const Layout: Component;
  export const Typography: {
    Title: Component;
    Paragraph: Component;
  };
}

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: unknown;
  }
}


declare module 'vite' {
  export function defineConfig(config: unknown): unknown;
}
