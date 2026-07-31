import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '@community-selection/config';
import { contractFail, contractOk } from '@community-selection/shared';
import { parseMemberImportFile } from '../../modules/member-import/member-file-parser.js';
import { PrismaMemberImportRepository } from '../../modules/member-import/member-import-repository.js';
import { createMemberImportService } from '../../modules/member-import/member-import-service.js';
import {
  requireAdminPermissionV1,
  resolveAdminAccessContext,
} from '../../modules/admin-access/admin-access-control.js';

type MemberImportService = ReturnType<typeof createMemberImportService>;

function traceId(request: FastifyRequest) {
  return String(request.id);
}

function sanitized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['phoneFingerprint', 'rawPhone'].includes(key))
      .map(([key, item]) => [key, sanitized(item)]),
  );
}

function sourceValue(fields: Record<string, unknown>) {
  const field = fields.source_name;
  const item = Array.isArray(field) ? field[0] : field;
  if (!item || typeof item !== 'object' || !('value' in item)) return '';
  return String(item.value ?? '').trim();
}

function handleError(request: FastifyRequest, reply: { code(status: number): unknown }, error: unknown) {
  const status = typeof error === 'object' && error && 'statusCode' in error
    ? Number(error.statusCode) || 400
    : 400;
  reply.code(status);
  return contractFail({
    code: status === 404 ? 'MEMBER_IMPORT_NOT_FOUND' : status === 409 ? 'MEMBER_IMPORT_CONFLICT' : 'INVALID_MEMBER_IMPORT',
    message: error instanceof Error ? error.message : '老会员导入失败',
    traceId: traceId(request),
  });
}

export function registerAdminMemberImportRoutes(
  app: FastifyInstance,
  service: MemberImportService = createMemberImportService(
    new PrismaMemberImportRepository(),
    { secret: config.memberPhoneHmacSecret },
  ),
) {
  const guard = requireAdminPermissionV1('admin.full_access');

  app.post('/api/admin/member-imports/preview', {
    config: { adminContractV1: true },
    preHandler: guard,
  }, async (request, reply) => {
    try {
      const part = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } });
      if (!part) throw new Error('请选择 CSV 或 .xlsx 文件');
      const buffer = await part.toBuffer();
      const sourceName = sourceValue(part.fields as unknown as Record<string, unknown>);
      if (!sourceName) throw new Error('来源说明不能为空');
      const context = resolveAdminAccessContext(request)!;
      const result = await service.preview({
        sourceName,
        fileName: part.filename,
        fileSha256: createHash('sha256').update(buffer).digest('hex'),
        operatorId: context.admin_user_id,
        rows: await parseMemberImportFile({ filename: part.filename, buffer }),
      });
      return contractOk(sanitized(result), {
        code: 'ADMIN_MEMBER_IMPORT_PREVIEWED',
        message: '导入预览已生成',
        traceId: traceId(request),
      });
    } catch (error) {
      return handleError(request, reply, error);
    }
  });

  app.post('/api/admin/member-imports/:id/confirm', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request, reply) => {
    try {
      const context = resolveAdminAccessContext(request)!;
      const result = await service.confirm((request.params as { id: string }).id, context.admin_user_id);
      return contractOk(sanitized(result), { code: 'ADMIN_MEMBER_IMPORT_CONFIRMED', message: '老会员资格已确认', traceId: traceId(request) });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.get('/api/admin/member-imports', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request, reply) => {
    try {
      return contractOk(sanitized(await service.list()), { code: 'ADMIN_MEMBER_IMPORT_LIST', message: '', traceId: traceId(request) });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.get('/api/admin/member-imports/:id', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request, reply) => {
    try {
      return contractOk(sanitized(await service.detail((request.params as { id: string }).id)), { code: 'ADMIN_MEMBER_IMPORT_DETAIL', message: '', traceId: traceId(request) });
    } catch (error) { return handleError(request, reply, error); }
  });

  app.post('/api/admin/member-import-eligibilities/:id/revoke', {
    config: { adminContractV1: true }, preHandler: guard,
  }, async (request, reply) => {
    try {
      const context = resolveAdminAccessContext(request)!;
      const result = await service.revoke((request.params as { id: string }).id, context.admin_user_id);
      return contractOk(sanitized(result), { code: 'ADMIN_MEMBER_ELIGIBILITY_REVOKED', message: '资格已撤销', traceId: traceId(request) });
    } catch (error) { return handleError(request, reply, error); }
  });
}
