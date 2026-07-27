import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db.js';
import { registerPaymentRoutes } from './payments.js';

const apps: ReturnType<typeof Fastify>[] = [];
const activeUser = {
  id: 'user-a',
  openid: 'openid-a',
  unionid: null,
  role: 'customer' as const,
  status: 'active',
  nickname: '用户 A',
  avatar_url: null,
  phone: null,
  created_at: new Date('2026-07-26T00:00:00.000Z'),
  updated_at: new Date('2026-07-26T00:00:00.000Z'),
};

function buildTestApp(options: Parameters<typeof registerPaymentRoutes>[1]) {
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
  registerPaymentRoutes(app, options);
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('payment routes', () => {
  it('initializes JSAPI with the server-owned user and order only', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(activeUser);
    const initializeWechatPayment = vi.fn(async () => ({
      payment_id: 'payment-a',
      request_payment: { package: 'prepay_id=prepay-a' },
    }));
    const app = buildTestApp({
      paymentMode: 'wechat',
      initializeWechatPayment,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/wechat/jsapi',
      headers: { 'x-user-id': 'user-a' },
      payload: { order_id: 'order-a' },
    });

    expect(response.statusCode).toBe(200);
    expect(initializeWechatPayment).toHaveBeenCalledWith({
      userId: 'user-a',
      orderId: 'order-a',
      clientIp: '127.0.0.1',
    });
  });

  it('rejects client-supplied openid and unknown JSAPI fields as a 400', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(activeUser);
    const initializeWechatPayment = vi.fn();
    const app = buildTestApp({
      paymentMode: 'wechat',
      initializeWechatPayment,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/wechat/jsapi',
      headers: { 'x-user-id': 'user-a' },
      payload: { order_id: 'order-a', openid: 'forged-openid' },
    });

    expect(response.statusCode).toBe(400);
    expect(initializeWechatPayment).not.toHaveBeenCalled();
  });

  it('preserves exact notification bytes and returns an empty 204', async () => {
    const processWechatNotification = vi.fn(async () => ({ replay: false }));
    const app = buildTestApp({
      paymentMode: 'wechat',
      processWechatNotification,
    });
    const rawBody = '{\n  "id": "notify-a", "resource": {"ciphertext":"x"}\n}';

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/wechat/notify',
      headers: { 'content-type': 'application/json' },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(processWechatNotification).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: Buffer.from(rawBody) }),
    );
  });

  it('rejects real notifications while mock payment mode is active', async () => {
    const processWechatNotification = vi.fn();
    const app = buildTestApp({
      paymentMode: 'mock',
      processWechatNotification,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/payments/wechat/notify',
      payload: { id: 'notify-a' },
    });

    expect(response.statusCode).toBe(403);
    expect(processWechatNotification).not.toHaveBeenCalled();
  });
});
