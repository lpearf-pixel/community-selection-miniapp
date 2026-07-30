import { contractFail, contractOk } from '@community-selection/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../db.js';
import {
  requireAdminPermissionV1,
  resolveAdminAccessContext,
} from '../../modules/admin-access/admin-access-control.js';
import {
  parseReviewProductComplianceCommand,
  parseSubmitProductComplianceCommand,
} from '../../modules/compliance/product-compliance-command.js';
import {
  ProductComplianceCommandError,
  executeReviewProductCompliance,
  executeSubmitProductCompliance,
  getProductComplianceState,
} from '../../modules/compliance/product-compliance-executor.js';

function adminMeta(request: FastifyRequest) {
  return {
    ip_address: request.ip,
    user_agent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : null,
  };
}

function logUnexpected(
  request: FastifyRequest,
  input: { operation: string; target_id: string; error: unknown },
) {
  request.log.error({
    error_name:
      input.error instanceof Error ? input.error.name : 'UnknownError',
    operation: input.operation,
    target_id: input.target_id,
    trace_id: String(request.id),
  });
}

const MASKED_SUMMARY_FIELDS: Record<string, ReadonlySet<string>> = {
  business_license: new Set(['holder_name_masked', 'license_no_masked']),
  food_business_license: new Set([
    'holder_name_masked',
    'license_no_masked',
  ]),
  agricultural_producer_identity: new Set([
    'producer_name_masked',
    'identity_no_masked',
  ]),
  origin_certificate: new Set([
    'certificate_no_masked',
    'origin_masked',
    'issuer_masked',
  ]),
  quality_certificate: new Set([
    'certificate_no_masked',
    'issuer_masked',
  ]),
  market_stall_registration: new Set([
    'market_name_masked',
    'stall_no_masked',
  ]),
  purchase_agreement: new Set([
    'agreement_no_masked',
    'counterparty_masked',
  ]),
  batch_proof: new Set([
    'batch_no_masked',
    'origin_masked',
    'producer_name_masked',
  ]),
  purchase_voucher: new Set([
    'voucher_no_masked',
    'counterparty_masked',
    'purchase_date_masked',
  ]),
  inspection_report: new Set(['report_no_masked', 'issuer_masked']),
};
const PURCHASE_VOUCHER_TYPES = new Set([
  'invoice',
  'receipt',
  'purchase_agreement',
  'farmer_purchase_record',
  'market_ticket',
]);

function sanitizedMaskedSummary(value: unknown, evidenceType: string) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const allowed = MASKED_SUMMARY_FIELDS[evidenceType] ?? new Set<string>();
  const safe: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      typeof raw === 'string' &&
      allowed.has(key) &&
      raw.length <= 200 &&
      /[*•]/.test(raw) &&
      raw.replace(/[*•\s-]/g, '').length <= 6 &&
      !/(?:https?:\/\/|data:)/i.test(raw) &&
      !/\d{7,}/.test(raw)
    ) {
      safe[key] = raw;
    }
  }
  if (
    evidenceType === 'purchase_traceability' &&
    typeof (value as Record<string, unknown>).purchase_voucher_type ===
      'string' &&
    PURCHASE_VOUCHER_TYPES.has(
      (value as Record<string, string>).purchase_voucher_type,
    )
  ) {
    safe.purchase_voucher_type = (
      value as Record<string, string>
    ).purchase_voucher_type;
  }
  return safe;
}

function sourceComplete(supplier: {
  subject_type: string | null;
  source_address: string | null;
  market_name: string | null;
  stall_no: string | null;
  profile_fingerprint: string | null;
  profile_version: number;
}) {
  if (!supplier.profile_fingerprint || supplier.profile_version < 1) {
    return false;
  }
  if (
    supplier.subject_type === 'natural_person_producer' ||
    supplier.subject_type === 'collector'
  ) {
    return Boolean(supplier.source_address?.trim());
  }
  if (supplier.subject_type === 'market_stall') {
    return Boolean(supplier.market_name?.trim() && supplier.stall_no?.trim());
  }
  return Boolean(
    supplier.subject_type &&
      supplier.subject_type !== 'temporary_source',
  );
}

async function productWorkbenchDetails(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      primary_supplier: {
        select: {
          id: true,
          subject_type: true,
          status: true,
          source_address: true,
          market_name: true,
          stall_no: true,
          profile_fingerprint: true,
          profile_version: true,
          qualifications: {
            select: {
              id: true,
              qualification_type: true,
              version: true,
              status: true,
              valid_from: true,
              expires_at: true,
              masked_summary: true,
            },
            orderBy: [
              { qualification_type: 'asc' },
              { version: 'desc' },
            ],
          },
        },
      },
    },
  });
  if (!product) return null;
  const supplier = product.primary_supplier;
  const batchEvidence = supplier
    ? await prisma.productBatchEvidence.findMany({
        where: {
          batch: {
            product_id: productId,
            supplier_id: supplier.id,
          },
        },
        select: {
          id: true,
          evidence_type: true,
          status: true,
          expires_at: true,
          masked_summary: true,
        },
        orderBy: [{ evidence_type: 'asc' }, { id: 'asc' }],
      })
    : [];
  return {
    supplier: supplier
      ? {
          id: supplier.id,
          subject_type: supplier.subject_type,
          status: supplier.status,
          source_complete: sourceComplete(supplier),
          qualifications: supplier.qualifications.map((item: {
            id: string;
            qualification_type: string;
            version: number;
            status: string;
            valid_from: Date | null;
            expires_at: Date | null;
            masked_summary: unknown;
          }) => ({
            id: item.id,
            qualification_type: item.qualification_type,
            version: item.version,
            status: item.status,
            valid_from: item.valid_from?.toISOString() ?? null,
            expires_at: item.expires_at?.toISOString() ?? null,
            masked_summary: sanitizedMaskedSummary(
              item.masked_summary,
              item.qualification_type,
            ),
          })),
        }
      : null,
    batch_evidence: batchEvidence.map((item) => ({
      id: item.id,
      evidence_type: item.evidence_type,
      status: item.status,
      expires_at: item.expires_at?.toISOString() ?? null,
      masked_summary: sanitizedMaskedSummary(
        item.masked_summary,
        item.evidence_type,
      ),
    })),
  };
}

async function supplierWorkbenchDetails(supplierId: string) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      name: true,
      subject_type: true,
      status: true,
      source_address: true,
      market_name: true,
      stall_no: true,
      profile_fingerprint: true,
      profile_version: true,
      qualifications: {
        select: {
          id: true,
          qualification_type: true,
          version: true,
          status: true,
          valid_from: true,
          expires_at: true,
          masked_summary: true,
        },
        orderBy: [
          { qualification_type: 'asc' },
          { version: 'desc' },
        ],
      },
    },
  });
  if (!supplier) return null;
  return {
    id: supplier.id,
    name: supplier.name,
    subject_type: supplier.subject_type,
    status: supplier.status,
    source_complete: sourceComplete(supplier),
    qualifications: supplier.qualifications.map((item: {
      id: string;
      qualification_type: string;
      version: number;
      status: string;
      valid_from: Date | null;
      expires_at: Date | null;
      masked_summary: unknown;
    }) => ({
      id: item.id,
      qualification_type: item.qualification_type,
      version: item.version,
      status: item.status,
      valid_from: item.valid_from?.toISOString() ?? null,
      expires_at: item.expires_at?.toISOString() ?? null,
      masked_summary: sanitizedMaskedSummary(
        item.masked_summary,
        item.qualification_type,
      ),
    })),
  };
}

function evidenceAccessCommand(input: unknown) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).length !== 1 ||
    typeof body.purpose !== 'string' ||
    body.purpose !== body.purpose.trim() ||
    body.purpose.length === 0 ||
    body.purpose.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(body.purpose)
  ) {
    return null;
  }
  return { purpose: body.purpose };
}

export function registerAdminComplianceRoutes(app: FastifyInstance) {
  app.get(
    '/api/admin/suppliers/:id/compliance',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('product.manage'),
    },
    async (request, reply) => {
      const traceId = String(request.id);
      const supplierId = (request.params as { id: string }).id;
      try {
        const state = await supplierWorkbenchDetails(supplierId);
        if (!state) {
          reply.code(404);
          return contractFail({
            code: 'ADMIN_SUPPLIER_NOT_FOUND',
            message: '供应商不存在',
            traceId,
          });
        }
        return contractOk(state, {
          code: 'ADMIN_SUPPLIER_COMPLIANCE_READ',
          message: '',
          traceId,
        });
      } catch (error) {
        logUnexpected(request, {
          operation: 'supplier_compliance_read',
          target_id: supplierId,
          error,
        });
        reply.code(500);
        return contractFail({
          code: 'ADMIN_SUPPLIER_COMPLIANCE_READ_FAILED',
          message: '供应商合规状态查询失败',
          traceId,
        });
      }
    },
  );

  app.get(
    '/api/admin/products/:id/compliance',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('product.manage'),
    },
    async (request, reply) => {
      const traceId = String(request.id);
      const productId = (request.params as { id: string }).id;
      try {
        const [state, details] = await Promise.all([
          getProductComplianceState(productId),
          productWorkbenchDetails(productId),
        ]);
        return contractOk({ ...state, ...(details ?? {
          supplier: null,
          batch_evidence: [],
        }) }, {
          code: 'ADMIN_PRODUCT_COMPLIANCE_READ',
          message: '',
          traceId,
        });
      } catch (error) {
        if (error instanceof ProductComplianceCommandError) {
          reply.code(error.statusCode);
          return contractFail({
            code: error.code,
            message: error.message,
            traceId,
          });
        }
        logUnexpected(request, {
          operation: 'read',
          target_id: productId,
          error,
        });
        reply.code(500);
        return contractFail({
          code: 'ADMIN_PRODUCT_COMPLIANCE_READ_FAILED',
          message: '商品合规状态查询失败',
          traceId,
        });
      }
    },
  );

  app.post(
    '/api/admin/products/:id/compliance/submit',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('product.manage'),
    },
    async (request, reply) => {
      const traceId = String(request.id);
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return contractFail({
          code: 'ADMIN_UNAUTHORIZED',
          message: '管理员身份无效',
          traceId,
        });
      }
      const parsed = parseSubmitProductComplianceCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }
      const productId = (request.params as { id: string }).id;
      try {
        return contractOk(
          await executeSubmitProductCompliance({
            product_id: productId,
            command: parsed.value,
            context,
            admin_meta: adminMeta(request),
          }),
          {
            code: 'ADMIN_PRODUCT_COMPLIANCE_SUBMITTED',
            message: '商品合规材料提交成功',
            traceId,
          },
        );
      } catch (error) {
        if (error instanceof ProductComplianceCommandError) {
          reply.code(error.statusCode);
          return contractFail({
            code: error.code,
            message: error.message,
            traceId,
          });
        }
        logUnexpected(request, {
          operation: 'submit',
          target_id: productId,
          error,
        });
        reply.code(500);
        return contractFail({
          code: 'ADMIN_PRODUCT_COMPLIANCE_SUBMIT_FAILED',
          message: '商品合规提交失败',
          traceId,
        });
      }
    },
  );

  app.post(
    '/api/admin/product-compliance-reviews/:id/review',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('product.manage'),
    },
    async (request, reply) => {
      const traceId = String(request.id);
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return contractFail({
          code: 'ADMIN_UNAUTHORIZED',
          message: '管理员身份无效',
          traceId,
        });
      }
      const parsed = parseReviewProductComplianceCommand(request.body);
      if (!parsed.ok) {
        reply.code(400);
        return contractFail({
          code: parsed.code,
          message: parsed.message,
          traceId,
        });
      }
      const reviewId = (request.params as { id: string }).id;
      try {
        return contractOk(
          await executeReviewProductCompliance({
            review_id: reviewId,
            command: parsed.value,
            context,
            admin_meta: adminMeta(request),
          }),
          {
            code: 'ADMIN_PRODUCT_COMPLIANCE_REVIEWED',
            message: '商品合规审核完成',
            traceId,
          },
        );
      } catch (error) {
        if (error instanceof ProductComplianceCommandError) {
          reply.code(error.statusCode);
          return contractFail({
            code: error.code,
            message: error.message,
            traceId,
          });
        }
        logUnexpected(request, {
          operation: 'review',
          target_id: reviewId,
          error,
        });
        reply.code(500);
        return contractFail({
          code: 'ADMIN_PRODUCT_COMPLIANCE_REVIEW_FAILED',
          message: '商品合规审核失败',
          traceId,
        });
      }
    },
  );

  app.post(
    '/api/admin/compliance-evidence/:evidenceType/:evidenceId/access',
    {
      config: { adminContractV1: true },
      preHandler: requireAdminPermissionV1('product.manage'),
    },
    async (request, reply) => {
      const traceId = String(request.id);
      const context = resolveAdminAccessContext(request);
      if (!context) {
        reply.code(401);
        return contractFail({
          code: 'ADMIN_UNAUTHORIZED',
          message: '管理员身份无效',
          traceId,
        });
      }
      const params = request.params as {
        evidenceType: string;
        evidenceId: string;
      };
      const supported =
        params.evidenceType === 'supplier_qualification' ||
        params.evidenceType === 'product_batch_evidence';
      const command = evidenceAccessCommand(request.body);
      if (!supported || !command) {
        reply.code(400);
        return contractFail({
          code: 'INVALID_EVIDENCE_ACCESS_COMMAND',
          message: '证据访问命令不合法',
          traceId,
        });
      }
      try {
        await prisma.complianceEvidenceAccessLog.create({
          data: {
            admin_user_id: context.admin_user_id,
            evidence_type: params.evidenceType,
            evidence_id: params.evidenceId,
            purpose: command.purpose,
            outcome: 'denied_adapter_unavailable',
            ip_address: request.ip,
            user_agent:
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : null,
          },
        });
      } catch (error) {
        logUnexpected(request, {
          operation: 'evidence_access_audit',
          target_id: params.evidenceId,
          error,
        });
        reply.code(500);
        return contractFail({
          code: 'EVIDENCE_ACCESS_AUDIT_FAILED',
          message: '证据访问审计失败',
          traceId,
        });
      }
      reply.code(503);
      return contractFail({
        code: 'EVIDENCE_DOWNLOAD_UNAVAILABLE',
        message: '受控证据存储适配器尚未配置',
        traceId,
      });
    },
  );
}
