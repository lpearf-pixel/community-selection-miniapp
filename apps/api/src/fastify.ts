type Handler = (request: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown }, reply: FastifyReply) => unknown | Promise<unknown>;

type Route = { method: string; path: string; handler: Handler };

export type FastifyReply = {
  statusCode: number;
  headers: Record<string, string>;
  code(statusCode: number): FastifyReply;
  header(name: string, value: string): FastifyReply;
};

export type FastifyInstance = {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  listen(options: { port: number; host?: string }): Promise<string>;
  inject(options: { method?: string; url: string; payload?: unknown }): Promise<{ statusCode: number; body: string; json(): unknown }>;
};

function makeReply(): FastifyReply {
  return {
    statusCode: 200,
    headers: {},
    code(statusCode: number) {
      this.statusCode = statusCode;
      return this;
    },
    header(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    }
  };
}

function matchRoute(routePath: string, url: string): { matched: boolean; params: Record<string, string>; query: Record<string, string> } {
  const parsed = new URL(url, 'http://localhost');
  const routeParts = routePath.split('/').filter(Boolean);
  const urlParts = parsed.pathname.split('/').filter(Boolean);
  if (routeParts.length !== urlParts.length) return { matched: false, params: {}, query: {} };

  const params: Record<string, string> = {};
  for (let index = 0; index < routeParts.length; index += 1) {
    const routePart = routeParts[index];
    const urlPart = urlParts[index];
    if (routePart.startsWith(':')) {
      params[routePart.slice(1)] = decodeURIComponent(urlPart);
    } else if (routePart !== urlPart) {
      return { matched: false, params: {}, query: {} };
    }
  }

  return { matched: true, params, query: Object.fromEntries(parsed.searchParams.entries()) };
}

export default function Fastify(_options?: unknown): FastifyInstance {
  const routes: Route[] = [];

  return {
    get(path: string, handler: Handler) {
      routes.push({ method: 'GET', path, handler });
    },
    post(path: string, handler: Handler) {
      routes.push({ method: 'POST', path, handler });
    },
    async listen(options: { port: number; host?: string }) {
      return `${options.host ?? '127.0.0.1'}:${options.port}`;
    },
    async inject(options: { method?: string; url: string; payload?: unknown }) {
      const method = (options.method ?? 'GET').toUpperCase();
      for (const route of routes) {
        if (route.method !== method) continue;
        const matched = matchRoute(route.path, options.url);
        if (!matched.matched) continue;
        const reply = makeReply();
        const result = await route.handler({ params: matched.params, query: matched.query, body: options.payload }, reply);
        const body = typeof result === 'string' ? result : JSON.stringify(result ?? null);
        return { statusCode: reply.statusCode, body, json: () => JSON.parse(body) };
      }
      return { statusCode: 404, body: JSON.stringify({ success: false, data: null, message: 'Not Found' }), json: () => ({ success: false, data: null, message: 'Not Found' }) };
    }
  };
}
