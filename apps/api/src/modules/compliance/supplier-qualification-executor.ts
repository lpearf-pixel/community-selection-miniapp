import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import type {
  ReviewSupplierQualificationCommand,
  RevokeSupplierQualificationCommand,
  SubmitSupplierQualificationCommand,
} from './supplier-qualification-command.js';

type AdminMeta = { ip_address?: string | null; user_agent?: string | null };

export type SupplierQualificationDto = {
  id: string;
  supplier_id: string;
  qualification_type: string;
  version: number;
  status: string;
  issued_at: string | null;
  valid_from: string | null;
  expires_at: string | null;
  submitted_at: string;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  revoked_by_admin_id: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
};

export class SupplierQualificationCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_SUPPLIER_NOT_FOUND'
      | 'ADMIN_SUPPLIER_QUALIFICATION_NOT_FOUND'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT'
      | 'ADMIN_SUPPLIER_QUALIFICATION_SUBMIT_FAILED'
      | 'ADMIN_SUPPLIER_QUALIFICATION_REVIEW_FAILED'
      | 'ADMIN_SUPPLIER_QUALIFICATION_REVOKE_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'SupplierQualificationCommandError';
  }
}

const operation = {
  submit: 'admin.supplier.qualification.submit.v1',
  review: 'admin.supplier.qualification.review.v1',
  revoke: 'admin.supplier.qualification.revoke.v1',
} as const;

const successCode = {
  submit: 'ADMIN_SUPPLIER_QUALIFICATION_SUBMITTED',
  review: 'ADMIN_SUPPLIER_QUALIFICATION_REVIEWED',
  revoke: 'ADMIN_SUPPLIER_QUALIFICATION_REVOKED',
} as const;

function commandError(
  statusCode: number,
  code: SupplierQualificationCommandError['code'],
  message: string,
) {
  return new SupplierQualificationCommandError(statusCode, code, message);
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function dto(row: {
  id: string;
  supplier_id: string;
  qualification_type: string;
  version: number;
  status: string;
  issued_at: Date | null;
  valid_from: Date | null;
  expires_at: Date | null;
  submitted_at: Date;
  reviewed_by_admin_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  revoked_by_admin_id: string | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
}): SupplierQualificationDto {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    qualification_type: row.qualification_type,
    version: row.version,
    status: row.status,
    issued_at: row.issued_at?.toISOString() ?? null,
    valid_from: row.valid_from?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    submitted_at: row.submitted_at.toISOString(),
    reviewed_by_admin_id: row.reviewed_by_admin_id,
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
    review_note: row.review_note,
    revoked_by_admin_id: row.revoked_by_admin_id,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    revoke_reason: row.revoke_reason,
  };
}

function isDto(value: unknown): value is SupplierQualificationDto {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.supplier_id === 'string' &&
    typeof item.qualification_type === 'string' &&
    Number.isSafeInteger(item.version) &&
    typeof item.status === 'string' &&
    typeof item.submitted_at === 'string'
  );
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type ReceiptInput = {
  operation: string;
  success_code: string;
  target_id: string;
  request_hash: string;
  admin_user_id: string;
  idempotency_key: string;
  failed_code: SupplierQualificationCommandError['code'];
  failed_message: string;
};

async function replay(input: ReceiptInput): Promise<SupplierQualificationDto> {
  const receipt = await prisma.adminCommandReceipt.findUnique({
    where: {
      admin_user_id_idempotency_key: {
        admin_user_id: input.admin_user_id,
        idempotency_key: input.idempotency_key,
      },
    },
  });
  if (!receipt) throw commandError(500, input.failed_code, input.failed_message);
  if (receipt.request_hash !== input.request_hash) {
    throw commandError(409, 'ADMIN_IDEMPOTENCY_KEY_REUSED', '幂等键已被其他命令使用');
  }
  if (
    receipt.operation !== input.operation ||
    receipt.target_id !== input.target_id ||
    receipt.completed_at === null ||
    receipt.response_http_status !== 200 ||
    receipt.response_code !== input.success_code ||
    !isDto(receipt.response_data)
  ) {
    throw commandError(500, input.failed_code, input.failed_message);
  }
  return receipt.response_data;
}

async function executeIdempotent(
  input: ReceiptInput,
  action: (tx: Prisma.TransactionClient, receiptId: string) => Promise<SupplierQualificationDto>,
): Promise<SupplierQualificationDto> {
  const key = {
    admin_user_id: input.admin_user_id,
    idempotency_key: input.idempotency_key,
  };
  const existing = await prisma.adminCommandReceipt.findUnique({
    where: { admin_user_id_idempotency_key: key },
    select: { id: true },
  });
  if (existing) return replay(input);

  try {
    return await prisma.$transaction(async (tx) => {
      const receipt = await tx.adminCommandReceipt.create({
        data: {
          ...key,
          operation: input.operation,
          target_id: input.target_id,
          request_hash: input.request_hash,
        },
      });
      const result = await action(tx, receipt.id);
      await tx.adminCommandReceipt.update({
        where: { id: receipt.id },
        data: {
          response_http_status: 200,
          response_code: input.success_code,
          response_data: result as Prisma.InputJsonValue,
          completed_at: new Date(),
        },
      });
      return result;
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const concurrent = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: key },
      select: { id: true },
    });
    if (concurrent) return replay(input);
    throw commandError(
      409,
      'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT',
      '供应商资质状态已变化，请刷新后重试',
    );
  }
}

function receiptInput(input: {
  operation: string;
  success_code: string;
  target_id: string;
  request: unknown;
  context: AdminAccessContext;
  idempotency_key: string;
  failed_code: SupplierQualificationCommandError['code'];
  failed_message: string;
}): ReceiptInput {
  return {
    operation: input.operation,
    success_code: input.success_code,
    target_id: input.target_id,
    request_hash: hashRequest({ operation: input.operation, request: input.request }),
    admin_user_id: input.context.admin_user_id,
    idempotency_key: input.idempotency_key,
    failed_code: input.failed_code,
    failed_message: input.failed_message,
  };
}

export async function executeSubmitSupplierQualification(input: {
  supplier_id: string;
  command: SubmitSupplierQualificationCommand;
  context: AdminAccessContext;
  admin_meta: AdminMeta;
}): Promise<SupplierQualificationDto> {
  const receipt = receiptInput({
    operation: operation.submit,
    success_code: successCode.submit,
    target_id: input.supplier_id,
    request: { supplier_id: input.supplier_id, command: input.command },
    context: input.context,
    idempotency_key: input.command.idempotency_key,
    failed_code: 'ADMIN_SUPPLIER_QUALIFICATION_SUBMIT_FAILED',
    failed_message: '供应商资质提交失败',
  });
  return executeIdempotent(receipt, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplier_id } });
    if (!supplier) throw commandError(404, 'ADMIN_SUPPLIER_NOT_FOUND', '供应商不存在');
    const previous = await tx.supplierQualification.findFirst({
      where: { supplier_id: supplier.id, qualification_type: input.command.qualification_type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const created = await tx.supplierQualification.create({
      data: {
        supplier_id: supplier.id,
        qualification_type: input.command.qualification_type,
        version: (previous?.version ?? 0) + 1,
        status: 'submitted',
        object_key: input.command.object_key,
        file_sha256: input.command.file_sha256,
        issued_at: input.command.issued_at,
        valid_from: input.command.valid_from,
        expires_at: input.command.expires_at,
        masked_summary: input.command.masked_summary as Prisma.InputJsonValue,
        critical_fingerprint: hashRequest({
          supplier_id: supplier.id,
          qualification_type: input.command.qualification_type,
          object_key: input.command.object_key,
          file_sha256: input.command.file_sha256,
          issued_at: input.command.issued_at,
          valid_from: input.command.valid_from,
          expires_at: input.command.expires_at,
          masked_summary: input.command.masked_summary,
        }),
        submitted_by_admin_id: input.context.admin_user_id,
      },
    });
    await recordAdminAudit(tx, {
      admin_user_id: input.context.admin_user_id,
      action: 'supplier_qualification_submitted',
      target_type: 'SupplierQualification',
      target_id: created.id,
      ip_address: input.admin_meta.ip_address ?? null,
      user_agent: input.admin_meta.user_agent ?? null,
      payload: {
        supplier_id: supplier.id,
        qualification_type: created.qualification_type,
        version: created.version,
        idempotency_key: input.command.idempotency_key,
      },
    });
    return dto(created);
  });
}

export async function executeReviewSupplierQualification(input: {
  qualification_id: string;
  command: ReviewSupplierQualificationCommand;
  context: AdminAccessContext;
  admin_meta: AdminMeta;
}): Promise<SupplierQualificationDto> {
  const receipt = receiptInput({
    operation: operation.review,
    success_code: successCode.review,
    target_id: input.qualification_id,
    request: { qualification_id: input.qualification_id, command: input.command },
    context: input.context,
    idempotency_key: input.command.idempotency_key,
    failed_code: 'ADMIN_SUPPLIER_QUALIFICATION_REVIEW_FAILED',
    failed_message: '供应商资质审核失败',
  });
  return executeIdempotent(receipt, async (tx) => {
    const changed = await tx.supplierQualification.updateMany({
      where: { id: input.qualification_id, status: input.command.expected_status },
      data: {
        status: input.command.decision === 'approve' ? 'approved' : 'rejected',
        reviewed_by_admin_id: input.context.admin_user_id,
        reviewed_at: new Date(),
        review_note: input.command.review_note,
      },
    });
    if (changed.count !== 1) {
      const exists = await tx.supplierQualification.findUnique({
        where: { id: input.qualification_id },
        select: { id: true },
      });
      if (!exists) {
        throw commandError(404, 'ADMIN_SUPPLIER_QUALIFICATION_NOT_FOUND', '供应商资质不存在');
      }
      throw commandError(409, 'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT', '供应商资质状态已变化，请刷新后重试');
    }
    const updated = await tx.supplierQualification.findUniqueOrThrow({
      where: { id: input.qualification_id },
    });
    await recordAdminAudit(tx, {
      admin_user_id: input.context.admin_user_id,
      action: 'supplier_qualification_reviewed',
      target_type: 'SupplierQualification',
      target_id: updated.id,
      ip_address: input.admin_meta.ip_address ?? null,
      user_agent: input.admin_meta.user_agent ?? null,
      payload: {
        supplier_id: updated.supplier_id,
        decision: input.command.decision,
        expected_status: input.command.expected_status,
        idempotency_key: input.command.idempotency_key,
      },
    });
    return dto(updated);
  });
}

export async function executeRevokeSupplierQualification(input: {
  qualification_id: string;
  command: RevokeSupplierQualificationCommand;
  context: AdminAccessContext;
  admin_meta: AdminMeta;
}): Promise<SupplierQualificationDto> {
  const receipt = receiptInput({
    operation: operation.revoke,
    success_code: successCode.revoke,
    target_id: input.qualification_id,
    request: { qualification_id: input.qualification_id, command: input.command },
    context: input.context,
    idempotency_key: input.command.idempotency_key,
    failed_code: 'ADMIN_SUPPLIER_QUALIFICATION_REVOKE_FAILED',
    failed_message: '供应商资质撤销失败',
  });
  return executeIdempotent(receipt, async (tx) => {
    const changed = await tx.supplierQualification.updateMany({
      where: { id: input.qualification_id, status: input.command.expected_status },
      data: {
        status: 'revoked',
        revoked_by_admin_id: input.context.admin_user_id,
        revoked_at: new Date(),
        revoke_reason: input.command.reason,
      },
    });
    if (changed.count !== 1) {
      const exists = await tx.supplierQualification.findUnique({
        where: { id: input.qualification_id },
        select: { id: true },
      });
      if (!exists) {
        throw commandError(404, 'ADMIN_SUPPLIER_QUALIFICATION_NOT_FOUND', '供应商资质不存在');
      }
      throw commandError(409, 'ADMIN_SUPPLIER_QUALIFICATION_STATUS_CONFLICT', '供应商资质状态已变化，请刷新后重试');
    }
    const updated = await tx.supplierQualification.findUniqueOrThrow({
      where: { id: input.qualification_id },
    });
    await recordAdminAudit(tx, {
      admin_user_id: input.context.admin_user_id,
      action: 'supplier_qualification_revoked',
      target_type: 'SupplierQualification',
      target_id: updated.id,
      ip_address: input.admin_meta.ip_address ?? null,
      user_agent: input.admin_meta.user_agent ?? null,
      payload: {
        supplier_id: updated.supplier_id,
        expected_status: input.command.expected_status,
        idempotency_key: input.command.idempotency_key,
      },
    });
    return dto(updated);
  });
}
