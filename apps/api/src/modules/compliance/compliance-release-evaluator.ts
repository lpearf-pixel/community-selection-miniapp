import { createHash } from 'node:crypto';
import { FIRST_LAUNCH_CATEGORY_RULE_VERSION } from './first-launch-category-rules.js';
import {
  SUPPLIER_QUALIFICATION_RULE_VERSION,
  evaluateProductComplianceState,
  loadCurrentComplianceFacts,
} from './product-compliance-executor.js';
import { PRODUCT_COMPLIANCE_FINGERPRINT_VERSION } from './product-compliance-fingerprint.js';

export type ComplianceReleaseReasonCode =
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
  | 'PRODUCT_COMPLIANCE_FINGERPRINT_CHANGED'
  | 'EVIDENCE_GENERATION_FAILED';

export type ComplianceRuleVersions = {
  category: string;
  qualification: string;
  fingerprint: string;
};

export type ComplianceReleaseProductEvidence = {
  product_id: string;
  passed: boolean;
  reason_codes: ComplianceReleaseReasonCode[];
  current_fingerprint: string | null;
  approved_fingerprint: string | null;
  review_id: string | null;
};

export type ComplianceReleaseEvidence = {
  passed: boolean;
  git_sha: string;
  checked_at: string;
  summary: {
    active_product_count: number;
    approved_valid_count: number;
    blocked_product_count: number;
  };
  products: ComplianceReleaseProductEvidence[];
  rule_versions: ComplianceRuleVersions;
};

type ReviewRow = {
  id: string;
  status: string;
  compliance_fingerprint: string;
};

type ComplianceReleaseDb = {
  product: {
    findMany(input: {
      where: { status: 'active' };
      select: { id: true };
      orderBy: { id: 'asc' };
    }): Promise<Array<{ id: string }>>;
  };
  productComplianceReview: {
    findFirst(input: {
      where: { product_id: string; status: 'approved' };
      select: {
        id: true;
        status: true;
        compliance_fingerprint: true;
      };
      orderBy: Array<
        | { reviewed_at: 'desc' }
        | { created_at: 'desc' }
      >;
    }): Promise<ReviewRow | null>;
  };
  opsAlertLog: {
    upsert(input: {
      where: { dedupe_key: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

const RULE_VERSIONS: ComplianceRuleVersions = {
  category: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
  qualification: SUPPLIER_QUALIFICATION_RULE_VERSION,
  fingerprint: PRODUCT_COMPLIANCE_FINGERPRINT_VERSION,
};

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function sha256(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function failedProduct(productId: string): ComplianceReleaseProductEvidence {
  return {
    product_id: productId,
    passed: false,
    reason_codes: ['EVIDENCE_GENERATION_FAILED'],
    current_fingerprint: null,
    approved_fingerprint: null,
    review_id: null,
  };
}

function buildEvidence(
  products: ComplianceReleaseProductEvidence[],
  input: { gitSha: string; checkedAt: Date },
  activeProductCount = products.length,
): ComplianceReleaseEvidence {
  const blocked = products.filter((item) => !item.passed).length;
  return {
    passed: blocked === 0,
    git_sha: input.gitSha,
    checked_at: input.checkedAt.toISOString(),
    summary: {
      active_product_count: activeProductCount,
      approved_valid_count: products.filter((item) => item.passed).length,
      blocked_product_count: blocked,
    },
    products: [...products].sort((left, right) =>
      left.product_id.localeCompare(right.product_id),
    ),
    rule_versions: RULE_VERSIONS,
  };
}

async function writeBlockedAlert(
  client: ComplianceReleaseDb,
  evidence: ComplianceReleaseEvidence,
) {
  if (evidence.passed) return true;
  const blocked = evidence.products.filter((item) => !item.passed);
  const failure = {
    product_ids: blocked.map((item) => item.product_id).sort(),
    reason_codes: uniqueSorted(
      blocked.flatMap((item) => item.reason_codes),
    ),
    rule_versions: evidence.rule_versions,
  };
  const dedupeKey =
    `l53-d2:${evidence.rule_versions.category}:${sha256(failure)}`;
  const data = {
    alert_type: 'l53_d2_compliance_release_blocked',
    alert_level: 'critical',
    status: 'open',
    title: '生产发布被商品合规门禁阻止',
    message: `${blocked.length} 个在售商品未通过商品合规发布门禁`,
    payload: failure,
  };
  try {
    await client.opsAlertLog.upsert({
      where: { dedupe_key: dedupeKey },
      create: { ...data, dedupe_key: dedupeKey },
      update: data,
    });
    return true;
  } catch {
    return false;
  }
}

function markAlertPersistenceFailure(evidence: ComplianceReleaseEvidence) {
  return {
    ...evidence,
    products: evidence.products.map((item) =>
      item.passed
        ? item
        : {
            ...item,
            reason_codes: uniqueSorted([
              ...item.reason_codes,
              'EVIDENCE_GENERATION_FAILED' as const,
            ]),
          },
    ),
  };
}

export async function evaluateComplianceRelease(
  client: ComplianceReleaseDb,
  input: { gitSha: string; checkedAt: Date },
): Promise<ComplianceReleaseEvidence> {
  let activeProducts: Array<{ id: string }>;
  try {
    activeProducts = await client.product.findMany({
      where: { status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
  } catch {
    const evidence = buildEvidence(
      [failedProduct('__release_evaluation__')],
      input,
      0,
    );
    return (await writeBlockedAlert(client, evidence))
      ? evidence
      : markAlertPersistenceFailure(evidence);
  }

  const products: ComplianceReleaseProductEvidence[] = [];
  for (const product of activeProducts) {
    try {
      const [facts, review] = await Promise.all([
        loadCurrentComplianceFacts(client as never, product.id),
        client.productComplianceReview.findFirst({
          where: { product_id: product.id, status: 'approved' },
          select: {
            id: true,
            status: true,
            compliance_fingerprint: true,
          },
          orderBy: [{ reviewed_at: 'desc' }, { created_at: 'desc' }],
        }),
      ]);
      if (!facts) {
        products.push(failedProduct(product.id));
        continue;
      }
      const state = evaluateProductComplianceState(
        facts as never,
        review,
        input.checkedAt,
      ) as {
        valid: boolean;
        reason_codes: ComplianceReleaseReasonCode[];
        current_fingerprint: string;
        approved_fingerprint: string | null;
        review_id: string | null;
      };
      products.push({
        product_id: product.id,
        passed: state.valid,
        reason_codes: uniqueSorted(state.reason_codes),
        current_fingerprint: state.current_fingerprint,
        approved_fingerprint: state.approved_fingerprint,
        review_id: state.review_id,
      });
    } catch {
      products.push(failedProduct(product.id));
    }
  }

  const evidence = buildEvidence(products, input);
  return (await writeBlockedAlert(client, evidence))
    ? evidence
    : markAlertPersistenceFailure(evidence);
}
