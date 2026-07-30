import { contractFail, contractOk } from '@community-selection/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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

export function registerAdminComplianceRoutes(app: FastifyInstance) {
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
        return contractOk(await getProductComplianceState(productId), {
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
}
