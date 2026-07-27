const assert = require('node:assert/strict');
const test = require('node:test');

function response(status, body, headers = {}) {
  return new Response(body, { status, headers });
}

function successfulFetch(url, options) {
  if (url === 'https://api.example.com/api/health') {
    return Promise.resolve(
      response(
        200,
        JSON.stringify({
          success: true,
          data: { status: 'ok' },
          message: '',
        }),
        { 'content-type': 'application/json' },
      ),
    );
  }
  if (url === 'https://admin.example.com/') {
    return Promise.resolve(
      response(200, '<!doctype html><html><body>Admin</body></html>', {
        'content-type': 'text/html; charset=utf-8',
      }),
    );
  }
  if (
    options?.redirect === 'manual' &&
    url === 'http://api.example.com/healthz'
  ) {
    return Promise.resolve(
      response(308, '', { location: 'https://api.example.com/healthz' }),
    );
  }
  if (
    options?.redirect === 'manual' &&
    url === 'http://admin.example.com/healthz'
  ) {
    return Promise.resolve(
      response(308, '', { location: 'https://admin.example.com/healthz' }),
    );
  }
  throw new Error(`Unexpected URL ${url}`);
}

test('accepts healthy HTTPS API, Admin HTML, and both redirects', async () => {
  const { smokeProduction } = await import('./smoke.mjs');
  const result = await smokeProduction({
    apiBaseUrl: 'https://api.example.com',
    adminBaseUrl: 'https://admin.example.com',
    fetchImpl: successfulFetch,
  });
  assert.deepEqual(result, {
    apiHealth: 'ok',
    adminHtml: 'ok',
    apiRedirect: 'ok',
    adminRedirect: 'ok',
  });
});

test('rejects a 200 API response with the wrong envelope', async () => {
  const { smokeProduction } = await import('./smoke.mjs');
  await assert.rejects(
    () =>
      smokeProduction({
        apiBaseUrl: 'https://api.example.com',
        adminBaseUrl: 'https://admin.example.com',
        fetchImpl(url, options) {
          if (url.endsWith('/api/health')) {
            return Promise.resolve(
              response(200, JSON.stringify({ status: 'ok' }), {
                'content-type': 'application/json',
              }),
            );
          }
          return successfulFetch(url, options);
        },
      }),
    /health envelope/,
  );
});

test('rejects an Admin response that is not HTML', async () => {
  const { smokeProduction } = await import('./smoke.mjs');
  await assert.rejects(
    () =>
      smokeProduction({
        apiBaseUrl: 'https://api.example.com',
        adminBaseUrl: 'https://admin.example.com',
        fetchImpl(url, options) {
          if (url === 'https://admin.example.com/') {
            return Promise.resolve(
              response(200, '{"ok":true}', {
                'content-type': 'application/json',
              }),
            );
          }
          return successfulFetch(url, options);
        },
      }),
    /Admin HTML/,
  );
});

test('rejects an HTTP endpoint that does not redirect to HTTPS', async () => {
  const { smokeProduction } = await import('./smoke.mjs');
  await assert.rejects(
    () =>
      smokeProduction({
        apiBaseUrl: 'https://api.example.com',
        adminBaseUrl: 'https://admin.example.com',
        fetchImpl(url, options) {
          if (url === 'http://api.example.com/healthz') {
            return Promise.resolve(response(200, 'ok'));
          }
          return successfulFetch(url, options);
        },
      }),
    /API HTTP redirect/,
  );
});
