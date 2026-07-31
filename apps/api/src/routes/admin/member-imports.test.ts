import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerAdminMemberImportRoutes } from './member-imports.js';

vi.mock('../../db.js', () => ({
  prisma: {
    adminUser: { findUnique: vi.fn(async () => ({ status: 'active' })) },
  },
}));

const fingerprint = 'a'.repeat(64);
const preview = vi.fn(async (input: { rows: unknown[] }) => ({
  id: 'batch-1',
  sourceName: '线下台账',
  status: 'preview',
  stats: { total: input.rows.length, valid: 1, duplicate: 0, invalid: 0, matched: 0, pending: 1 },
  rows: [{ id: 'row-1', rowNumber: 2, maskedPhone: '138****8000', phoneFingerprint: fingerprint, status: 'pending' }],
}));
const service = {
  preview,
  confirm: vi.fn(async () => ({ created: 1, skipped: 0, batch: { id: 'batch-1', status: 'confirmed' } })),
  list: vi.fn(async () => [{ id: 'batch-1', status: 'preview', stats: { total: 1 } }]),
  detail: vi.fn(async () => ({ id: 'batch-1', rows: [{ maskedPhone: '138****8000', phoneFingerprint: fingerprint }] })),
  revoke: vi.fn(async () => ({ id: 'eligibility-1', maskedPhone: '138****8000', phoneFingerprint: fingerprint, status: 'revoked' })),
};

const app = Fastify({ logger: false });
await app.register(multipart);
registerAdminMemberImportRoutes(app, service as never);

const superAdmin = {
  'x-admin-user-id': 'admin-1',
  'x-admin-role': 'super_admin',
};

function multipartPayload(source = '线下台账') {
  const boundary = '----l55-member-import-boundary';
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="source_name"\r\n\r\n${source}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="members.csv"\r\nContent-Type: text/csv\r\n\r\n手机号\n13800138000\n\r\n`,
    `--${boundary}--\r\n`,
  ].join('');
  return {
    headers: { ...superAdmin, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(body),
  };
}

beforeAll(async () => app.ready());
afterAll(async () => app.close());

describe('legacy member import Admin API', () => {
  it('requires a super-admin identity', async () => {
    const unauthorized = await app.inject({ method: 'GET', url: '/api/admin/member-imports' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({ success: false, code: 'ADMIN_UNAUTHORIZED' });

    const forbidden = await app.inject({
      method: 'GET', url: '/api/admin/member-imports',
      headers: { 'x-admin-user-id': 'clerk-1', 'x-admin-role': 'clerk' },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ success: false, code: 'ADMIN_FORBIDDEN' });
  });

  it('parses a multipart CSV preview and returns masked-only rows', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/member-imports/preview', ...multipartPayload(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      code: 'ADMIN_MEMBER_IMPORT_PREVIEWED',
      data: { id: 'batch-1', rows: [{ maskedPhone: '138****8000' }] },
    });
    expect(response.body).not.toContain('13800138000');
    expect(response.body).not.toContain(fingerprint);
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({
      sourceName: '线下台账', fileName: 'members.csv', operatorId: 'admin-1',
      rows: [{ rowNumber: 2, rawPhone: '13800138000' }],
    }));
  });

  it('requires a source description for preview', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/admin/member-imports/preview', ...multipartPayload(''),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, code: 'INVALID_MEMBER_IMPORT' });
  });

  it('confirms, lists, reads detail, and revokes without returning fingerprints', async () => {
    const requests = [
      app.inject({ method: 'POST', url: '/api/admin/member-imports/batch-1/confirm', headers: superAdmin }),
      app.inject({ method: 'GET', url: '/api/admin/member-imports', headers: superAdmin }),
      app.inject({ method: 'GET', url: '/api/admin/member-imports/batch-1', headers: superAdmin }),
      app.inject({ method: 'POST', url: '/api/admin/member-import-eligibilities/eligibility-1/revoke', headers: superAdmin }),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(responses.map((response) => response.body).join('')).not.toContain(fingerprint);
  });
});
