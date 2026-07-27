import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRefundRoutes } from './refunds.js';

const apps: ReturnType<typeof Fastify>[] = [];

function buildTestApp(
  options: Parameters<typeof registerRefundRoutes>[1],
) {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      request.rawBody = rawBody;
      try {
        done(null, JSON.parse(rawBody.toString('utf8')));
      } catch (error) {
        done(error as Error);
      }
    },
  );
  registerRefundRoutes(app, options);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('refund notification route', () => {
  it('passes exact raw bytes to the verified processor', async () => {
    const processWechatNotification = vi.fn(async () => ({ replay: false }));
    const app = buildTestApp({
      paymentMode: 'wechat',
      processWechatNotification,
    });
    const rawBody = '{\n "id": "refund-notify-a", "resource": {"x":1}\n}';

    const response = await app.inject({
      method: 'POST',
      url: '/api/refunds/wechat/notify',
      headers: { 'content-type': 'application/json' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(processWechatNotification).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: Buffer.from(rawBody) }),
    );
  });

  it('refuses real notifications in mock mode', async () => {
    const processWechatNotification = vi.fn();
    const app = buildTestApp({
      paymentMode: 'mock',
      processWechatNotification,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/refunds/wechat/notify',
      payload: { id: 'refund-notify-a' },
    });

    expect(response.statusCode).toBe(403);
    expect(processWechatNotification).not.toHaveBeenCalled();
  });

  it('rejects a notification when the raw request body is missing', async () => {
    const processWechatNotification = vi.fn();
    const app = buildTestApp({
      paymentMode: 'wechat',
      processWechatNotification,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/refunds/wechat/notify',
    });

    expect(response.statusCode).toBe(400);
    expect(processWechatNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['WECHAT_REFUND_NOT_FOUND', 400],
    ['database unavailable', 500],
  ])(
    'maps processor failure %s to HTTP %i',
    async (message, expectedStatus) => {
      const app = buildTestApp({
        paymentMode: 'wechat',
        processWechatNotification: vi.fn(async () => {
          throw new Error(message);
        }),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/refunds/wechat/notify',
        payload: { id: 'refund-notify-a' },
      });

      expect(response.statusCode).toBe(expectedStatus);
    },
  );
});
