type HttpRequestLogInput = {
  id?: unknown;
  method?: unknown;
  url?: unknown;
  ip?: unknown;
  raw?: {
    method?: unknown;
    url?: unknown;
    socket?: { remoteAddress?: unknown };
  };
};

type HttpResponseLogInput = {
  statusCode?: unknown;
  raw?: { statusCode?: unknown };
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function statusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function requestPath(url: string): string {
  const queryIndex = url.indexOf('?');
  const fragmentIndex = url.indexOf('#');
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const end = indexes.length > 0 ? Math.min(...indexes) : url.length;
  const path = url.slice(0, end);
  return path || '/';
}

export function serializeHttpRequest(request: HttpRequestLogInput) {
  const method = text(request.method) ?? text(request.raw?.method) ?? 'UNKNOWN';
  const url = text(request.url) ?? text(request.raw?.url) ?? '/';
  const remoteAddress =
    text(request.ip) ?? text(request.raw?.socket?.remoteAddress) ?? 'unknown';

  return {
    request_id: text(request.id) ?? 'unknown',
    method,
    path: requestPath(url),
    remote_address: remoteAddress,
  };
}

export function serializeHttpResponse(response: HttpResponseLogInput) {
  return {
    status_code:
      statusCode(response.statusCode) ?? statusCode(response.raw?.statusCode) ?? 0,
  };
}

export const HTTP_LOGGER_OPTIONS = {
  serializers: {
    req: serializeHttpRequest,
    res: serializeHttpResponse,
  },
  redact: {
    paths: [
      'req.headers',
      'req.body',
      'req.query',
      'req.cookies',
      'req.session',
      'res.headers',
    ],
    censor: '[FILTERED]',
  },
};
