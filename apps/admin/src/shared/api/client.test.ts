import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from './errors';
import { createJsonRequester } from './client';

describe('createJsonRequester', () => {
  it('returns envelope data and sends request context headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { id: 'order-1' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const request = createJsonRequester({
      baseUrl: 'http://api.test',
      fetchImpl,
      getDefaultHeaders: () => ({ 'x-admin-role': 'owner' }),
    });

    await expect(
      request<{ id: string }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ quantity: 1 }),
        context: {
          correlationId: 'corr-1',
          idempotencyKey: 'idem-1',
          timeoutMs: 1000,
        },
      }),
    ).resolves.toEqual({ id: 'order-1' });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('http://api.test/api/orders');
    expect(init.credentials).toBe('include');
    expect(init).not.toHaveProperty('context');
    expect(Object.fromEntries(headers.entries())).toMatchObject({
      'content-type': 'application/json',
      'idempotency-key': 'idem-1',
      'x-admin-role': 'owner',
      'x-correlation-id': 'corr-1',
    });
  });

  it('normalizes a public API error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          code: 'ADMIN_FORBIDDEN',
          message: '无权限',
          trace_id: 'trace-1',
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(request('/api/admin/private')).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 403,
      code: 'ADMIN_FORBIDDEN',
      traceId: 'trace-1',
      message: '无权限',
    } satisfies Partial<AdminApiError>);
  });

  it('aborts a request after its timeout budget', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(
      request('/api/slow', { context: { timeoutMs: 5 } }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('keeps timeout classification while reading the response body', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise<unknown>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(init.signal?.reason);
              });
            }),
        } as Response),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(
      request('/api/slow-body', { context: { timeoutMs: 5 } }),
    ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });

  it('distinguishes a caller cancellation from a timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });
    const controller = new AbortController();
    const pending = request('/api/cancelled', { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
  });

  it('keeps caller cancellation classification while reading the body', async () => {
    let markBodyStarted: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => {
            markBodyStarted?.();
            return new Promise<unknown>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(init.signal?.reason);
              });
            });
          },
        } as Response),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });
    const controller = new AbortController();
    const pending = request('/api/cancelled-body', {
      signal: controller.signal,
    });

    await bodyStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
  });

  it('normalizes invalid JSON responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200 }),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(request('/api/broken')).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    });
  });

  it.each([
    null,
    {},
    [],
    { success: true },
    { success: false, message: { private: 'detail' } },
  ])('rejects a malformed API envelope: %j', async (body) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(request('/api/malformed')).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    });
  });

  it('cleans its timer and caller abort listener after success', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const removeListener = vi.spyOn(
        controller.signal,
        'removeEventListener',
      );
      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: null }), {
          status: 200,
        }),
      );
      const request = createJsonRequester({ baseUrl: '', fetchImpl });

      await expect(
        request('/api/clean', {
          signal: controller.signal,
          context: { timeoutMs: 1000 },
        }),
      ).resolves.toBeNull();

      expect(vi.getTimerCount()).toBe(0);
      expect(removeListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes transport failures without exposing their message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('private network detail'));
    const request = createJsonRequester({ baseUrl: '', fetchImpl });

    await expect(request('/api/offline')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: '网络请求失败',
    });
  });
});
