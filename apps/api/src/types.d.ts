declare module 'fastify' {
  export type RouteHandler = (request: { query?: unknown; params?: unknown }, reply: { code(statusCode: number): void }) => unknown | Promise<unknown>;
  export type InjectOptions = { method: string; url: string };
  export type InjectResponse = { statusCode: number; json(): unknown };
  export type FastifyInstance = {
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

declare module '@prisma/client' {
  type QueryArgs = Record<string, unknown>;
  type Delegate = {
    findMany(args?: QueryArgs): Promise<unknown[]>;
    findUnique(args?: QueryArgs): Promise<unknown | null>;
    count(args?: QueryArgs): Promise<number>;
  };
  export class PrismaClient {
    category: Delegate;
    product: Delegate;
    community: Delegate;
    pickupStore: Delegate;
  }
}
