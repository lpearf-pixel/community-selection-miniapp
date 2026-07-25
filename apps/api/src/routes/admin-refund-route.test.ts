import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { prisma } from '../db.js';

const app = buildApp();
const adminId = `route-refund-admin-${Date.now()}`;
const command = {
  expected_version: 1,
  idempotency_key: 'admin-refund-route-0001',
  admin_remark: '执行退款',
};

beforeAll(async () => {
  await app.ready();
  await prisma.adminUser.create({
    data: {
      id: adminId,
      username: adminId,
      password_hash: 'integration-only',
      status: 'active',
    },
  });
});
afterAll(async () => {
  await prisma.adminUser.deleteMany({ where: { id: adminId } });
  await app.close();
  await prisma.$disconnect();
});

describe('Admin refund route boundary', () => {
  it('returns a V1 401 without Admin identity', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/after-sales/missing/refund-execute',
      payload: command,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'ADMIN_UNAUTHORIZED',
      trace_id: expect.any(String),
    });
  });

  it('rejects client-priced commands before domain execution', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/after-sales/missing/refund-execute',
      headers: {
        'x-admin-user-id': adminId,
        'x-admin-role': 'super_admin',
      },
      payload: { ...command, refund_amount_cents: 1 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      code: 'INVALID_ADMIN_REFUND_COMMAND',
      trace_id: expect.any(String),
    });
  });

  it.each(['/api/refunds/mock', '/api/refunds/wechat/apply'])(
    'does not register the retired public mutation %s',
    async (url) => {
      const response = await app.inject({
        method: 'POST',
        url,
        payload: {},
      });
      expect(response.statusCode).toBe(404);
    },
  );
});
