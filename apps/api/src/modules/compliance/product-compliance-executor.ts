import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { AdminAccessContext } from '../admin-access/admin-access-control.js';
import { recordAdminAudit } from '../audit/audit-service.js';
import {
  FIRST_LAUNCH_CATEGORY_RULE_VERSION,
  decideFirstLaunchCategory,
} from './first-launch-category-rules.js';
import type {
  ReviewProductComplianceCommand,
  SubmitProductComplianceCommand,
} from './product-compliance-command.js';
import { hasValidProductComplianceSubmitGuard } from './product-compliance-command.js';
import {
  PRODUCT_COMPLIANCE_FINGERPRINT_VERSION,
  buildProductComplianceFingerprint,
} from './product-compliance-fingerprint.js';

export const SUPPLIER_QUALIFICATION_RULE_VERSION =
  'l53-d2-supplier-qualification-v1';

type AdminMeta = { ip_address?: string | null; user_agent?: string | null };
type DbClient = Prisma.TransactionClient | typeof prisma;

export type ProductComplianceFacts = {
  product: {
    id: string;
    name: string;
    description: string | null;
    category_code: string | null;
    supplier_id: string | null;
    origin_text: string | null;
    labels: string[];
    cover_image: string | null;
    images: string[];
    updated_at: Date;
  };
  supplier: {
    id: string;
    status: string;
    subject_type: string | null;
    profile_fingerprint: string | null;
    profile_version: number;
  } | null;
  qualifications: Array<{
    id: string;
    qualification_type: string;
    version: number;
    status: string;
    critical_fingerprint: string;
    valid_from: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
  }>;
  batch_evidence: Array<{
    id: string;
    batch_id: string;
    status: string;
    evidence_type: string;
    evidence_fingerprint: string;
    expires_at: Date | null;
    revoked_at: Date | null;
  }>;
};

export type ProductComplianceReviewState = {
  id: string;
  status: string;
  compliance_fingerprint: string;
};

export type ProductComplianceReasonCode =
  | 'CATEGORY_CODE_MISSING'
  | 'CATEGORY_NOT_ALLOWED'
  | 'PRODUCT_SUPPLIER_MISSING'
  | 'SUPPLIER_INACTIVE'
  | 'SUPPLIER_PROFILE_INCOMPLETE'
  | 'SUPPLIER_TYPE_NOT_ELIGIBLE'
  | 'PRODUCT_ORIGIN_MISSING'
  | 'SUPPLIER_QUALIFICATION_INVALID'
  | 'PRODUCT_BATCH_EVIDENCE_INVALID'
  | 'PRODUCT_COMPLIANCE_NOT_APPROVED'
  | 'PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED';

const REQUIRED_QUALIFICATION_BY_SUBJECT: Record<string, string> = {
  company: 'business_license',
  cooperative: 'business_license',
  individual_business: 'business_license',
  natural_person_producer: 'agricultural_producer_identity',
  market_stall: 'market_stall_registration',
  collector: 'purchase_agreement',
};

function jsonStrings(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function validQualificationAt(
  item: {
    status: string;
    valid_from: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
  },
  now: Date,
) {
  return (
    item.status === 'approved' &&
    item.revoked_at === null &&
    (!item.valid_from || item.valid_from <= now) &&
    (!item.expires_at || item.expires_at > now)
  );
}

function validEvidenceAt(
  item: {
    status: string;
    expires_at: Date | null;
    revoked_at: Date | null;
  },
  now: Date,
) {
  return (
    item.status === 'active' &&
    item.revoked_at === null &&
    (!item.expires_at || item.expires_at > now)
  );
}

function latestQualifications(
  items: ProductComplianceFacts['qualifications'],
) {
  const latest = new Map<string, ProductComplianceFacts['qualifications'][number]>();
  for (const item of [...items].sort((left, right) => right.version - left.version)) {
    if (!latest.has(item.qualification_type)) {
      latest.set(item.qualification_type, item);
    }
  }
  return [...latest.values()].sort((left, right) =>
    left.qualification_type.localeCompare(right.qualification_type),
  );
}

export function buildCurrentProductCompliance(
  facts: ProductComplianceFacts,
  now = new Date(),
) {
  const reasons = new Set<ProductComplianceReasonCode>();
  const category = decideFirstLaunchCategory(facts.product.category_code);
  if (!category.allowed) reasons.add(category.reason);
  if (!facts.product.supplier_id || !facts.supplier) {
    reasons.add('PRODUCT_SUPPLIER_MISSING');
  } else {
    if (
      facts.supplier.id !== facts.product.supplier_id ||
      facts.supplier.status !== 'active'
    ) {
      reasons.add('SUPPLIER_INACTIVE');
    }
    if (
      !facts.supplier.profile_fingerprint?.trim() ||
      facts.supplier.profile_version < 1
    ) {
      reasons.add('SUPPLIER_PROFILE_INCOMPLETE');
    }
    if (
      !facts.supplier.subject_type ||
      facts.supplier.subject_type === 'temporary_source' ||
      !REQUIRED_QUALIFICATION_BY_SUBJECT[facts.supplier.subject_type]
    ) {
      reasons.add('SUPPLIER_TYPE_NOT_ELIGIBLE');
    }
  }
  if (!facts.product.origin_text?.trim()) reasons.add('PRODUCT_ORIGIN_MISSING');

  const latest = latestQualifications(facts.qualifications);
  const requiredQualification = facts.supplier?.subject_type
    ? REQUIRED_QUALIFICATION_BY_SUBJECT[facts.supplier.subject_type]
    : undefined;
  const activeQualifications = latest.filter((item) =>
    validQualificationAt(item, now),
  );
  if (
    !requiredQualification ||
    !activeQualifications.some(
      (item) => item.qualification_type === requiredQualification,
    )
  ) {
    reasons.add('SUPPLIER_QUALIFICATION_INVALID');
  }

  const activeEvidence = facts.batch_evidence
    .filter((item) => validEvidenceAt(item, now))
    .sort((left, right) =>
      `${left.batch_id}:${left.evidence_type}:${left.id}`.localeCompare(
        `${right.batch_id}:${right.evidence_type}:${right.id}`,
      ),
    );
  if (activeEvidence.length === 0) {
    reasons.add('PRODUCT_BATCH_EVIDENCE_INVALID');
  }

  const qualificationHashes = activeQualifications
    .map((item) => item.critical_fingerprint)
    .sort();
  const evidenceHashes = activeEvidence
    .map((item) => item.evidence_fingerprint)
    .sort();
  const complianceFingerprint = buildProductComplianceFingerprint({
    name: facts.product.name,
    description: facts.product.description,
    category_code: facts.product.category_code,
    supplier_id: facts.product.supplier_id,
    supplier_subject_type: facts.supplier?.subject_type ?? null,
    supplier_profile_fingerprint:
      facts.supplier?.profile_fingerprint ?? null,
    supplier_profile_version: facts.supplier?.profile_version ?? null,
    origin_text: facts.product.origin_text,
    qualification_hashes: qualificationHashes,
    batch_evidence_hashes: evidenceHashes,
    labels: facts.product.labels,
    cover_image: facts.product.cover_image,
    images: facts.product.images,
  });

  return {
    eligible: reasons.size === 0,
    reason_codes: [...reasons].sort(),
    compliance_fingerprint: complianceFingerprint,
    fingerprint_version: PRODUCT_COMPLIANCE_FINGERPRINT_VERSION,
    category_rule_version: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
    qualification_rule_version: SUPPLIER_QUALIFICATION_RULE_VERSION,
    snapshots: {
      product: {
        id: facts.product.id,
        name: facts.product.name,
        description: facts.product.description,
        category_code: facts.product.category_code,
        primary_supplier_id: facts.product.supplier_id,
        origin_text: facts.product.origin_text,
        labels: [...facts.product.labels].sort(),
        cover_image: facts.product.cover_image,
        images: [...facts.product.images].sort(),
        updated_at: facts.product.updated_at.toISOString(),
      },
      supplier: facts.supplier
        ? {
            id: facts.supplier.id,
            status: facts.supplier.status,
            subject_type: facts.supplier.subject_type,
            profile_fingerprint: facts.supplier.profile_fingerprint,
            profile_version: facts.supplier.profile_version,
          }
        : null,
      qualifications: latest.map((item) => ({
        id: item.id,
        qualification_type: item.qualification_type,
        version: item.version,
        status: item.status,
        critical_fingerprint: item.critical_fingerprint,
        valid_from: item.valid_from?.toISOString() ?? null,
        expires_at: item.expires_at?.toISOString() ?? null,
        revoked_at: item.revoked_at?.toISOString() ?? null,
      })),
      batch_evidence: facts.batch_evidence
        .map((item) => ({
          id: item.id,
          batch_id: item.batch_id,
          evidence_type: item.evidence_type,
          status: item.status,
          evidence_fingerprint: item.evidence_fingerprint,
          expires_at: item.expires_at?.toISOString() ?? null,
          revoked_at: item.revoked_at?.toISOString() ?? null,
        }))
        .sort((left, right) =>
          `${left.batch_id}:${left.evidence_type}:${left.id}`.localeCompare(
            `${right.batch_id}:${right.evidence_type}:${right.id}`,
          ),
        ),
    },
  };
}

export function evaluateProductComplianceState(
  facts: ProductComplianceFacts,
  review: ProductComplianceReviewState | null,
  now = new Date(),
) {
  const current = buildCurrentProductCompliance(facts, now);
  const reasons = new Set<ProductComplianceReasonCode>(current.reason_codes);
  if (!review || review.status !== 'approved') {
    reasons.add('PRODUCT_COMPLIANCE_NOT_APPROVED');
  } else if (review.compliance_fingerprint !== current.compliance_fingerprint) {
    reasons.add('PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED');
  }
  return {
    valid: reasons.size === 0,
    reason_codes: [...reasons].sort(),
    current_fingerprint: current.compliance_fingerprint,
    approved_fingerprint: review?.compliance_fingerprint ?? null,
    review_id: review?.id ?? null,
    review_status: review?.status ?? null,
    rule_versions: {
      category: current.category_rule_version,
      qualification: current.qualification_rule_version,
      fingerprint: current.fingerprint_version,
    },
  };
}

export async function loadCurrentComplianceFacts(
  tx: DbClient,
  productId: string,
): Promise<ProductComplianceFacts | null> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      description: true,
      primary_supplier_id: true,
      origin_text: true,
      labels: true,
      cover_image: true,
      images: true,
      updated_at: true,
      category: { select: { compliance_code: true } },
      primary_supplier: {
        select: {
          id: true,
          status: true,
          subject_type: true,
          profile_fingerprint: true,
          profile_version: true,
        },
      },
    },
  });
  if (!product) return null;

  const [qualifications, batchEvidence] = await Promise.all([
    product.primary_supplier_id
      ? tx.supplierQualification.findMany({
          where: { supplier_id: product.primary_supplier_id },
          select: {
            id: true,
            qualification_type: true,
            version: true,
            status: true,
            critical_fingerprint: true,
            valid_from: true,
            expires_at: true,
            revoked_at: true,
          },
          orderBy: [{ qualification_type: 'asc' }, { version: 'desc' }],
        })
      : Promise.resolve([]),
    tx.productBatchEvidence.findMany({
      where: {
        batch: {
          product_id: product.id,
          ...(product.primary_supplier_id
            ? { supplier_id: product.primary_supplier_id }
            : {}),
        },
      },
      select: {
        id: true,
        batch_id: true,
        status: true,
        evidence_type: true,
        evidence_fingerprint: true,
        expires_at: true,
        revoked_at: true,
      },
    }),
  ]);

  return {
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      category_code: product.category.compliance_code,
      supplier_id: product.primary_supplier_id,
      origin_text: product.origin_text,
      labels: jsonStrings(product.labels),
      cover_image: product.cover_image,
      images: jsonStrings(product.images),
      updated_at: product.updated_at,
    },
    supplier: product.primary_supplier,
    qualifications,
    batch_evidence: batchEvidence,
  };
}

export type ProductComplianceDto = {
  id: string;
  product_id: string;
  status: string;
  compliance_fingerprint: string;
  fingerprint_version: string;
  category_rule_version: string;
  qualification_rule_version: string;
  submitted_by_admin_id: string;
  submitted_at: string;
  reviewed_by_admin_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  effective_valid: boolean;
  reason_codes: ProductComplianceReasonCode[];
};

export class ProductComplianceCommandError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code:
      | 'ADMIN_PRODUCT_NOT_FOUND'
      | 'ADMIN_PRODUCT_COMPLIANCE_REVIEW_NOT_FOUND'
      | 'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE'
      | 'ADMIN_PRODUCT_COMPLIANCE_COMMAND_INVALID'
      | 'ADMIN_PRODUCT_COMPLIANCE_VERSION_CONFLICT'
      | 'ADMIN_PRODUCT_COMPLIANCE_STATUS_CONFLICT'
      | 'ADMIN_IDEMPOTENCY_KEY_REUSED'
      | 'ADMIN_PRODUCT_COMPLIANCE_SUBMIT_FAILED'
      | 'ADMIN_PRODUCT_COMPLIANCE_REVIEW_FAILED',
    message: string,
    public readonly reason_codes: ProductComplianceReasonCode[] = [],
  ) {
    super(message);
    this.name = 'ProductComplianceCommandError';
  }
}

function commandError(
  statusCode: number,
  code: ProductComplianceCommandError['code'],
  message: string,
  reasonCodes: ProductComplianceReasonCode[] = [],
) {
  return new ProductComplianceCommandError(
    statusCode,
    code,
    message,
    reasonCodes,
  );
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

type ReviewRow = {
  id: string;
  product_id: string;
  status: string;
  compliance_fingerprint: string;
  fingerprint_version: string;
  category_rule_version: string;
  qualification_rule_version: string;
  submitted_by_admin_id: string;
  submitted_at: Date;
  reviewed_by_admin_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
};

function dto(
  row: ReviewRow,
  state: ReturnType<typeof evaluateProductComplianceState>,
): ProductComplianceDto {
  return {
    id: row.id,
    product_id: row.product_id,
    status: row.status,
    compliance_fingerprint: row.compliance_fingerprint,
    fingerprint_version: row.fingerprint_version,
    category_rule_version: row.category_rule_version,
    qualification_rule_version: row.qualification_rule_version,
    submitted_by_admin_id: row.submitted_by_admin_id,
    submitted_at: row.submitted_at.toISOString(),
    reviewed_by_admin_id: row.reviewed_by_admin_id,
    reviewed_at: row.reviewed_at?.toISOString() ?? null,
    review_note: row.review_note,
    effective_valid: state.valid,
    reason_codes: state.reason_codes,
  };
}

function isDto(value: unknown): value is ProductComplianceDto {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.product_id === 'string' &&
    typeof item.status === 'string' &&
    typeof item.compliance_fingerprint === 'string' &&
    Array.isArray(item.reason_codes)
  );
}

type ReceiptInput = {
  operation: string;
  success_code: string;
  target_id: string;
  request_hash: string;
  admin_user_id: string;
  idempotency_key: string;
  failed_code:
    | 'ADMIN_PRODUCT_COMPLIANCE_SUBMIT_FAILED'
    | 'ADMIN_PRODUCT_COMPLIANCE_REVIEW_FAILED';
  failed_message: string;
};

async function replay(input: ReceiptInput): Promise<ProductComplianceDto> {
  const receipt = await prisma.adminCommandReceipt.findUnique({
    where: {
      admin_user_id_idempotency_key: {
        admin_user_id: input.admin_user_id,
        idempotency_key: input.idempotency_key,
      },
    },
  });
  if (!receipt) {
    throw commandError(500, input.failed_code, input.failed_message);
  }
  if (receipt.request_hash !== input.request_hash) {
    throw commandError(
      409,
      'ADMIN_IDEMPOTENCY_KEY_REUSED',
      '幂等键已被其他命令使用',
    );
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
  const review = await prisma.productComplianceReview.findUnique({
    where: { id: receipt.response_data.id },
  });
  if (!review) {
    throw commandError(500, input.failed_code, input.failed_message);
  }
  const facts = await loadCurrentComplianceFacts(prisma, review.product_id);
  if (!facts) {
    throw commandError(500, input.failed_code, input.failed_message);
  }
  return dto(review, evaluateProductComplianceState(facts, review));
}

async function executeIdempotent(
  input: ReceiptInput,
  action: (
    tx: Prisma.TransactionClient,
    receiptId: string,
  ) => Promise<ProductComplianceDto>,
) {
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
    if (
      !(
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
    ) {
      throw error;
    }
    const concurrent = await prisma.adminCommandReceipt.findUnique({
      where: { admin_user_id_idempotency_key: key },
      select: { id: true },
    });
    if (concurrent) return replay(input);
    throw commandError(
      409,
      'ADMIN_PRODUCT_COMPLIANCE_STATUS_CONFLICT',
      '商品合规状态已变化，请刷新后重试',
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
  failed_code: ReceiptInput['failed_code'];
  failed_message: string;
}): ReceiptInput {
  return {
    operation: input.operation,
    success_code: input.success_code,
    target_id: input.target_id,
    request_hash: requestHash({
      operation: input.operation,
      request: input.request,
    }),
    admin_user_id: input.context.admin_user_id,
    idempotency_key: input.idempotency_key,
    failed_code: input.failed_code,
    failed_message: input.failed_message,
  };
}

export async function getProductComplianceState(productId: string) {
  const facts = await loadCurrentComplianceFacts(prisma, productId);
  if (!facts) {
    throw commandError(404, 'ADMIN_PRODUCT_NOT_FOUND', '商品不存在');
  }
  const latest = await prisma.productComplianceReview.findFirst({
    where: { product_id: productId },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
  const current = buildCurrentProductCompliance(facts);
  const state = evaluateProductComplianceState(facts, latest);
  return {
    product_id: productId,
    product_updated_at: facts.product.updated_at.toISOString(),
    current_fingerprint: current.compliance_fingerprint,
    eligible_for_submission: current.eligible,
    reason_codes: state.reason_codes,
    latest_review: latest ? dto(latest, state) : null,
    rule_versions: state.rule_versions,
  };
}

export async function executeSubmitProductCompliance(input: {
  product_id: string;
  command: SubmitProductComplianceCommand;
  context: AdminAccessContext;
  admin_meta: AdminMeta;
}): Promise<ProductComplianceDto> {
  if (!hasValidProductComplianceSubmitGuard(input.command)) {
    throw commandError(
      400,
      'ADMIN_PRODUCT_COMPLIANCE_COMMAND_INVALID',
      '商品合规提交命令缺少并发前置条件',
    );
  }
  const receipt = receiptInput({
    operation: 'admin.product.compliance.submit.v1',
    success_code: 'ADMIN_PRODUCT_COMPLIANCE_SUBMITTED',
    target_id: input.product_id,
    request: { product_id: input.product_id, command: input.command },
    context: input.context,
    idempotency_key: input.command.idempotency_key,
    failed_code: 'ADMIN_PRODUCT_COMPLIANCE_SUBMIT_FAILED',
    failed_message: '商品合规提交失败',
  });
  return executeIdempotent(receipt, async (tx) => {
    const facts = await loadCurrentComplianceFacts(tx, input.product_id);
    if (!facts) {
      throw commandError(404, 'ADMIN_PRODUCT_NOT_FOUND', '商品不存在');
    }
    const current = buildCurrentProductCompliance(facts);
    const timestampMatches =
      input.command.expected_updated_at === null ||
      input.command.expected_updated_at.getTime() ===
        facts.product.updated_at.getTime();
    const fingerprintMatches =
      input.command.expected_fingerprint === null ||
      input.command.expected_fingerprint === current.compliance_fingerprint;
    if (!timestampMatches || !fingerprintMatches) {
      throw commandError(
        409,
        'ADMIN_PRODUCT_COMPLIANCE_VERSION_CONFLICT',
        '商品合规事实已变化，请刷新后重试',
      );
    }
    if (!current.eligible) {
      throw commandError(
        422,
        'ADMIN_PRODUCT_COMPLIANCE_FACTS_INCOMPLETE',
        '商品合规事实不完整',
        current.reason_codes,
      );
    }
    const created = await tx.productComplianceReview.create({
      data: {
        product_id: input.product_id,
        status: 'submitted',
        compliance_fingerprint: current.compliance_fingerprint,
        fingerprint_version: current.fingerprint_version,
        category_rule_version: current.category_rule_version,
        qualification_rule_version: current.qualification_rule_version,
        product_snapshot: current.snapshots.product as Prisma.InputJsonValue,
        supplier_snapshot:
          current.snapshots.supplier === null
            ? Prisma.JsonNull
            : (current.snapshots.supplier as Prisma.InputJsonValue),
        qualification_snapshot:
          current.snapshots.qualifications as Prisma.InputJsonValue,
        batch_evidence_snapshot:
          current.snapshots.batch_evidence as Prisma.InputJsonValue,
        submitted_by_admin_id: input.context.admin_user_id,
        submitted_at: new Date(),
      },
    });
    await recordAdminAudit(tx, {
      admin_user_id: input.context.admin_user_id,
      action: 'product_compliance_submitted',
      target_type: 'ProductComplianceReview',
      target_id: created.id,
      ip_address: input.admin_meta.ip_address ?? null,
      user_agent: input.admin_meta.user_agent ?? null,
      payload: {
        product_id: input.product_id,
        compliance_fingerprint: current.compliance_fingerprint,
        idempotency_key: input.command.idempotency_key,
      },
    });
    return dto(
      created,
      evaluateProductComplianceState(facts, created),
    );
  });
}

export async function executeReviewProductCompliance(input: {
  review_id: string;
  command: ReviewProductComplianceCommand;
  context: AdminAccessContext;
  admin_meta: AdminMeta;
}): Promise<ProductComplianceDto> {
  const receipt = receiptInput({
    operation: 'admin.product.compliance.review.v1',
    success_code: 'ADMIN_PRODUCT_COMPLIANCE_REVIEWED',
    target_id: input.review_id,
    request: { review_id: input.review_id, command: input.command },
    context: input.context,
    idempotency_key: input.command.idempotency_key,
    failed_code: 'ADMIN_PRODUCT_COMPLIANCE_REVIEW_FAILED',
    failed_message: '商品合规审核失败',
  });
  return executeIdempotent(receipt, async (tx) => {
    const pending = await tx.productComplianceReview.findUnique({
      where: { id: input.review_id },
    });
    if (!pending) {
      throw commandError(
        404,
        'ADMIN_PRODUCT_COMPLIANCE_REVIEW_NOT_FOUND',
        '商品合规审核记录不存在',
      );
    }
    if (pending.status !== input.command.expected_status) {
      throw commandError(
        409,
        'ADMIN_PRODUCT_COMPLIANCE_STATUS_CONFLICT',
        '商品合规审核状态已变化，请刷新后重试',
      );
    }
    const facts = await loadCurrentComplianceFacts(tx, pending.product_id);
    if (!facts) {
      throw commandError(404, 'ADMIN_PRODUCT_NOT_FOUND', '商品不存在');
    }
    const current = buildCurrentProductCompliance(facts);
    if (
      input.command.decision === 'approve' &&
      (!current.eligible ||
        current.compliance_fingerprint !== pending.compliance_fingerprint)
    ) {
      throw commandError(
        409,
        'ADMIN_PRODUCT_COMPLIANCE_VERSION_CONFLICT',
        '商品合规事实已变化，请重新提交',
        current.reason_codes,
      );
    }
    const changed = await tx.productComplianceReview.updateMany({
      where: {
        id: input.review_id,
        status: input.command.expected_status,
      },
      data: {
        status: input.command.decision === 'approve' ? 'approved' : 'rejected',
        reviewed_by_admin_id: input.context.admin_user_id,
        reviewed_at: new Date(),
        review_note: input.command.review_note,
      },
    });
    if (changed.count !== 1) {
      throw commandError(
        409,
        'ADMIN_PRODUCT_COMPLIANCE_STATUS_CONFLICT',
        '商品合规审核状态已变化，请刷新后重试',
      );
    }
    const updated = await tx.productComplianceReview.findUniqueOrThrow({
      where: { id: input.review_id },
    });
    await recordAdminAudit(tx, {
      admin_user_id: input.context.admin_user_id,
      action: 'product_compliance_reviewed',
      target_type: 'ProductComplianceReview',
      target_id: updated.id,
      ip_address: input.admin_meta.ip_address ?? null,
      user_agent: input.admin_meta.user_agent ?? null,
      payload: {
        product_id: updated.product_id,
        decision: input.command.decision,
        expected_status: input.command.expected_status,
        idempotency_key: input.command.idempotency_key,
      },
    });
    return dto(
      updated,
      evaluateProductComplianceState(facts, updated),
    );
  });
}
