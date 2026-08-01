import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerAdminMemberGiftRoutes } from './member-gifts.js';

vi.mock('../../db.js', () => ({
  prisma: {
    adminUser: { findUnique: vi.fn(async () => ({ status: 'active' })) },
  },
}));

const deliver = vi.fn(async () => ({ claim_id: 'claim-1', status: 'delivered', idempotent: false }));
const writeOff = vi.fn(async () => ({ claim_id: 'claim-1', status: 'written_off', idempotent: false }));
const list = vi.fn(async () => ({ items: [{ claim_id: 'claim-1', status: 'reserved' }] }));

const app = Fastify({ logger: false });
registerAdminMemberGiftRoutes(app, { deliver, writeOff, list });

const superAdmin = {
  'x-admin-user-id': 'admin-1',
  'x-admin-role': 'super_admin',
};

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe('admin member gift API', () => {
  it('requires an active admin with order management permission', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/member-gift-claims' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ success: false, code: 'ADMIN_UNAUTHORIZED' });
  });

  it('delivers a reserved claim with an exact idempotent V1 command', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/member-gift-claims/claim-1/deliver',
      headers: superAdmin,
      payload: { idempotency_key: 'gift-deliver-command-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      code: 'ADMIN_MEMBER_GIFT_DELIVERED',
      data: { claim_id: 'claim-1', status: 'delivered' },
    });
    expect(deliver).toHaveBeenCalledWith({
      claimId: 'claim-1',
      context: expect.objectContaining({ admin_user_id: 'admin-1', is_super_admin: true }),
      idempotencyKey: 'gift-deliver-command-1',
    });
  });

  it('writes off only an allowed loss reason', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/member-gift-claims/claim-1/write-off',
      headers: superAdmin,
      payload: { reason: 'damaged', idempotency_key: 'gift-writeoff-command-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(writeOff).toHaveBeenCalledWith({
      claimId: 'claim-1', context: expect.objectContaining({ admin_user_id: 'admin-1', is_super_admin: true }), reason: 'damaged',
      idempotencyKey: 'gift-writeoff-command-1',
    });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/admin/member-gift-claims/claim-1/write-off',
      headers: superAdmin,
      payload: { reason: 'returned', idempotency_key: 'gift-writeoff-command-2' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ success: false, code: 'INVALID_ADMIN_MEMBER_GIFT_COMMAND' });
  });

  it('rejects unknown or client-owned fields before executing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/member-gift-claims/claim-1/deliver',
      headers: superAdmin,
      payload: { idempotency_key: 'gift-deliver-command-2', user_id: 'user-2' },
    });
    expect(response.statusCode).toBe(400);
    expect(deliver).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'gift-deliver-command-2' }));
  });
});
