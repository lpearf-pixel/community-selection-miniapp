import { AdminApiError } from './errors';
import {
  requestContextHeaders,
  type RequestContext,
} from './request-context';

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
  trace_id?: string;
};

function invalidResponse(status: number, cause?: unknown): AdminApiError {
  return new AdminApiError(
    '服务返回了无法识别的数据',
    status,
    'INVALID_RESPONSE',
    undefined,
    cause === undefined ? undefined : { cause },
  );
}

function parseApiEnvelope<T>(value: unknown, status: number): ApiEnvelope<T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(status);
  }

  const envelope = value as Record<string, unknown>;
  if (typeof envelope.success !== 'boolean') {
    throw invalidResponse(status);
  }
  if (envelope.success && !Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    throw invalidResponse(status);
  }
  for (const field of ['message', 'code', 'trace_id'] as const) {
    if (envelope[field] !== undefined && typeof envelope[field] !== 'string') {
      throw invalidResponse(status);
    }
  }

  return envelope as ApiEnvelope<T>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type JsonRequestOptions = Omit<RequestInit, 'signal'> & {
  signal?: AbortSignal | null;
  context?: RequestContext;
};

export type JsonRequester = <T>(
  path: string,
  options?: JsonRequestOptions,
) => Promise<T>;

export function createJsonRequester(config: {
  baseUrl: string;
  fetchImpl?: FetchLike;
  getDefaultHeaders?: () => HeadersInit;
}): JsonRequester {
  const fetchImpl = config.fetchImpl ?? fetch;

  return async function requestJson<T>(
    path: string,
    options: JsonRequestOptions = {},
  ): Promise<T> {
    const {
      context,
      signal: callerSignal,
      ...requestInit
    } = options;
    const controller = new AbortController();
    const timeoutMs = context?.timeoutMs;
    let timedOut = false;

    const abortFromCaller = () => {
      controller.abort(callerSignal?.reason);
    };
    if (callerSignal?.aborted) abortFromCaller();
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);

    try {
      const headers = new Headers(config.getDefaultHeaders?.());
      for (const [name, value] of Object.entries(
        requestContextHeaders(context),
      )) {
        headers.set(name, value);
      }
      new Headers(requestInit.headers).forEach((value, name) => {
        headers.set(name, value);
      });
      if (requestInit.body !== undefined && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }

      const response = await fetchImpl(config.baseUrl + path, {
        ...requestInit,
        credentials: 'include',
        headers,
        signal: controller.signal,
      });

      let envelope: ApiEnvelope<T>;
      try {
        envelope = parseApiEnvelope<T>(
          await response.json(),
          response.status,
        );
      } catch (error) {
        if (timedOut || callerSignal?.aborted) throw error;
        if (error instanceof AdminApiError) throw error;
        throw invalidResponse(response.status, error);
      }

      if (!response.ok || envelope.success !== true) {
        throw new AdminApiError(
          envelope.message ?? '请求失败',
          response.status,
          envelope.code ?? 'REQUEST_FAILED',
          envelope.trace_id,
        );
      }
      return envelope.data as T;
    } catch (error) {
      if (error instanceof AdminApiError) throw error;
      if (timedOut) {
        throw new AdminApiError(
          '请求超时',
          0,
          'REQUEST_TIMEOUT',
          undefined,
          { cause: error },
        );
      }
      if (callerSignal?.aborted) {
        throw new AdminApiError(
          '请求已取消',
          0,
          'REQUEST_ABORTED',
          undefined,
          { cause: error },
        );
      }
      throw new AdminApiError(
        '网络请求失败',
        0,
        'NETWORK_ERROR',
        undefined,
        { cause: error },
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    }
  };
}
