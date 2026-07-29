import type { FastifyInstance } from 'fastify';
import { contractFail, contractOk, fail, ok } from '@community-selection/shared';
import { createSupplier, disableSupplier, listSuppliers, updateSupplier } from '../modules/supplier/supplier-service.js';
import {
  requireAdminPermissionV1,
  resolveAdminAccessContext,
} from '../modules/admin-access/admin-access-control.js';
import {
  parseReviewSupplierQualificationCommand,
  parseRevokeSupplierQualificationCommand,
  parseSubmitSupplierQualificationCommand,
} from '../modules/compliance/supplier-qualification-command.js';
import {
  executeReviewSupplierQualification,
  executeRevokeSupplierQualification,
  executeSubmitSupplierQualification,
  SupplierQualificationCommandError,
} from '../modules/compliance/supplier-qualification-executor.js';

type SupplierBody = {
  name?: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  license_no?: string | null;
  certification_info?: unknown;
  remark?: string | null;
  subject_profile?: unknown;
};

function requireAdmin(request: { adminUser?: { id: string } }) {
  if (!request.adminUser?.id) throw new Error('后台登录已失效');
  return request.adminUser.id;
}

function adminMeta(request: { adminUser?: { id: string }; ip?: string; headers: Record<string, unknown> }) {
  return {
    admin_user_id: requireAdmin(request),
    ip_address: request.ip ?? null,
    user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null
  };
}

function qualificationAdminMeta(request: { ip?: string; headers: Record<string, unknown> }) {
  return {
    ip_address: request.ip ?? null,
    user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

export function registerSupplierRoutes(app: FastifyInstance) {
  app.get('/api/admin/suppliers', async (request, reply) => {
    try {
      requireAdmin(request);
      return ok(await listSuppliers(request.query as { status?: string }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '查询供应商失败');
    }
  });

  app.post('/api/admin/suppliers', async (request, reply) => {
    try {
      return ok(await createSupplier({ body: request.body as SupplierBody, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '创建供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/update', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await updateSupplier({ id, body: request.body as SupplierBody, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '更新供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/disable', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return ok(await disableSupplier({ id, admin: adminMeta(request) }));
    } catch (error) {
      reply.code(error instanceof Error && error.message === '后台登录已失效' ? 401 : 400);
      return fail(error instanceof Error ? error.message : '禁用供应商失败');
    }
  });

  app.post('/api/admin/suppliers/:id/qualifications/submit', {
    config: { adminContractV1: true },
    preHandler: requireAdminPermissionV1('product.manage'),
  }, async (request, reply) => {
    const traceId = String(request.id);
    const context = resolveAdminAccessContext(request);
    if (!context) {
      reply.code(401);
      return contractFail({ code: 'ADMIN_UNAUTHORIZED', message: '管理员身份无效', traceId });
    }
    const command = parseSubmitSupplierQualificationCommand(request.body);
    if (!command.ok) {
      reply.code(400);
      return contractFail({ code: command.code, message: command.message, traceId });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await executeSubmitSupplierQualification({
        supplier_id: id,
        command: command.value,
        context,
        admin_meta: qualificationAdminMeta(request),
      });
      return contractOk(result, { code: 'ADMIN_SUPPLIER_QUALIFICATION_SUBMITTED', message: '供应商资质提交成功', traceId });
    } catch (error) {
      if (error instanceof SupplierQualificationCommandError) {
        reply.code(error.statusCode);
        return contractFail({ code: error.code, message: error.message, traceId });
      }
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError', supplier_id: id, trace_id: traceId }, 'Supplier qualification submit failed');
      reply.code(500);
      return contractFail({ code: 'ADMIN_SUPPLIER_QUALIFICATION_SUBMIT_FAILED', message: '供应商资质提交失败', traceId });
    }
  });

  app.post('/api/admin/supplier-qualifications/:id/review', {
    config: { adminContractV1: true },
    preHandler: requireAdminPermissionV1('product.manage'),
  }, async (request, reply) => {
    const traceId = String(request.id);
    const context = resolveAdminAccessContext(request);
    if (!context) {
      reply.code(401);
      return contractFail({ code: 'ADMIN_UNAUTHORIZED', message: '管理员身份无效', traceId });
    }
    const command = parseReviewSupplierQualificationCommand(request.body);
    if (!command.ok) {
      reply.code(400);
      return contractFail({ code: command.code, message: command.message, traceId });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await executeReviewSupplierQualification({
        qualification_id: id,
        command: command.value,
        context,
        admin_meta: qualificationAdminMeta(request),
      });
      return contractOk(result, { code: 'ADMIN_SUPPLIER_QUALIFICATION_REVIEWED', message: '供应商资质审核成功', traceId });
    } catch (error) {
      if (error instanceof SupplierQualificationCommandError) {
        reply.code(error.statusCode);
        return contractFail({ code: error.code, message: error.message, traceId });
      }
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError', qualification_id: id, trace_id: traceId }, 'Supplier qualification review failed');
      reply.code(500);
      return contractFail({ code: 'ADMIN_SUPPLIER_QUALIFICATION_REVIEW_FAILED', message: '供应商资质审核失败', traceId });
    }
  });

  app.post('/api/admin/supplier-qualifications/:id/revoke', {
    config: { adminContractV1: true },
    preHandler: requireAdminPermissionV1('product.manage'),
  }, async (request, reply) => {
    const traceId = String(request.id);
    const context = resolveAdminAccessContext(request);
    if (!context) {
      reply.code(401);
      return contractFail({ code: 'ADMIN_UNAUTHORIZED', message: '管理员身份无效', traceId });
    }
    const command = parseRevokeSupplierQualificationCommand(request.body);
    if (!command.ok) {
      reply.code(400);
      return contractFail({ code: command.code, message: command.message, traceId });
    }
    const { id } = request.params as { id: string };
    try {
      const result = await executeRevokeSupplierQualification({
        qualification_id: id,
        command: command.value,
        context,
        admin_meta: qualificationAdminMeta(request),
      });
      return contractOk(result, { code: 'ADMIN_SUPPLIER_QUALIFICATION_REVOKED', message: '供应商资质撤销成功', traceId });
    } catch (error) {
      if (error instanceof SupplierQualificationCommandError) {
        reply.code(error.statusCode);
        return contractFail({ code: error.code, message: error.message, traceId });
      }
      request.log.error({ error_name: error instanceof Error ? error.name : 'UnknownError', qualification_id: id, trace_id: traceId }, 'Supplier qualification revoke failed');
      reply.code(500);
      return contractFail({ code: 'ADMIN_SUPPLIER_QUALIFICATION_REVOKE_FAILED', message: '供应商资质撤销失败', traceId });
    }
  });
}
