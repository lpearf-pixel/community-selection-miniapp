declare module 'react' {
  export const StrictMode: unknown;
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): { render(node: unknown): void };
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
