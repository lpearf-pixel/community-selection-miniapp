import { describe, expect, it } from 'vitest';
import {
  HTTP_LOGGER_OPTIONS,
  requestPath,
  serializeHttpRequest,
  serializeHttpResponse,
} from './http-log-privacy.js';

describe('HTTP log privacy', () => {
  it('removes the complete query string from request paths', () => {
    expect(
      requestPath(
        '/api/me/orders?user_id=unique-marker&phone=13900000000#fragment',
      ),
    ).toBe('/api/me/orders');
    expect(requestPath('/api/health')).toBe('/api/health');
    expect(requestPath('')).toBe('/');
  });

  it('serializes only request id, method, path, and remote address', () => {
    const request = {
      id: 'req-1',
      method: 'POST',
      url: '/api/me/orders?identity=unique-marker',
      ip: '127.0.0.1',
      headers: {
        'x-user-id': 'unique-marker',
        authorization: 'Bearer unique-marker',
        cookie: 'session=unique-marker',
      },
      body: {
        phone: '13900000000',
        receiver_address: 'unique-marker-address',
      },
      query: { identity: 'unique-marker' },
      cookies: { session: 'unique-marker' },
      session: { user_id: 'unique-marker' },
    } as any;

    expect(serializeHttpRequest(request)).toEqual({
      request_id: 'req-1',
      method: 'POST',
      path: '/api/me/orders',
      remote_address: '127.0.0.1',
    });

    const serialized = JSON.stringify(serializeHttpRequest(request));
    for (const forbidden of [
      'unique-marker',
      '13900000000',
      'authorization',
      'cookie',
      'headers',
      'body',
      'query',
      'session',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('serializes responses with status code only', () => {
    const response = {
      statusCode: 403,
      headers: {
        'set-cookie': 'session=unique-marker',
        authorization: 'unique-marker',
      },
      payload: { secret: 'unique-marker' },
    } as any;

    expect(serializeHttpResponse(response)).toEqual({ status_code: 403 });
    expect(JSON.stringify(serializeHttpResponse(response))).not.toContain(
      'unique-marker',
    );
  });

  it('exports the safe serializers through the Fastify logger options', () => {
    expect(HTTP_LOGGER_OPTIONS.serializers.req).toBe(serializeHttpRequest);
    expect(HTTP_LOGGER_OPTIONS.serializers.res).toBe(serializeHttpResponse);
    expect(HTTP_LOGGER_OPTIONS.redact).toEqual({
      paths: [
        'req.headers',
        'req.body',
        'req.query',
        'req.cookies',
        'req.session',
        'res.headers',
      ],
      censor: '[FILTERED]',
    });
  });
});
