import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../db.js';
import { registerAdminComplianceRoutes } from './compliance.js';

const nonce = `l53d2-access-${Date.now()}`;
const ids = {
  admin: `${nonce}-admin`,
  evidence: `${nonce}-evidence`,
};
const app = Fastify({ logger: false });

describe.skipIf(!process.env.DATABASE_URL)(
  'compliance evidence access audit on PostgreSQL',
  () => {
    beforeAll(async () => {
      await prisma.adminUser.create({
        data: {
          id: ids.admin,
          username: ids.admin,
          password_hash: 'integration',
          status: 'active',
        },
      });
      registerAdminComplianceRoutes(app);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      await prisma.complianceEvidenceAccessLog.deleteMany({
        where: { admin_user_id: ids.admin },
      });
      await prisma.adminUser.deleteMany({ where: { id: ids.admin } });
    });

    it('persists the denied access fact before returning unavailable', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/compliance-evidence/product_batch_evidence/${ids.evidence}/access`,
        headers: {
          'x-admin-user-id': ids.admin,
          'x-admin-role': 'super_admin',
          'user-agent': 'l53-d2-access-integration',
        },
        payload: { purpose: '复核批次采购凭证' },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        success: false,
        data: null,
        code: 'EVIDENCE_DOWNLOAD_UNAVAILABLE',
      });
      expect(response.body).not.toMatch(
        /object_key|file_sha256|signed_url|storage_signature/i,
      );

      const rows = await prisma.complianceEvidenceAccessLog.findMany({
        where: {
          admin_user_id: ids.admin,
          evidence_type: 'product_batch_evidence',
          evidence_id: ids.evidence,
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        purpose: '复核批次采购凭证',
        outcome: 'denied_adapter_unavailable',
        user_agent: 'l53-d2-access-integration',
      });
      expect(rows[0]?.ip_address).toBeTruthy();
    });
  },
);
