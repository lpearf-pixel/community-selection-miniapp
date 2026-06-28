declare module 'fastify' {
  type RouteHandler = () => unknown | Promise<unknown>;
  type InjectOptions = { method: string; url: string };
  type InjectResponse = { statusCode: number; json(): unknown };
  type FastifyInstance = {
    get(path: string, handler: RouteHandler): void;
    listen(options: { host: string; port: number }): Promise<string>;
    inject(options: InjectOptions): Promise<InjectResponse>;
  };
  export default function Fastify(options?: { logger?: boolean }): FastifyInstance;
}

declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => unknown | Promise<unknown>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
  };
}
