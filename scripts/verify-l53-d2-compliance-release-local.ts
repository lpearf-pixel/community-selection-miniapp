import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../apps/api/src/db.js';
import {
  type ComplianceReleaseEvidence,
  evaluateComplianceRelease,
} from '../apps/api/src/modules/compliance/compliance-release-evaluator.js';
import { FIRST_LAUNCH_CATEGORY_RULE_VERSION } from '../apps/api/src/modules/compliance/first-launch-category-rules.js';
import { SUPPLIER_QUALIFICATION_RULE_VERSION } from '../apps/api/src/modules/compliance/product-compliance-executor.js';
import { PRODUCT_COMPLIANCE_FINGERPRINT_VERSION } from '../apps/api/src/modules/compliance/product-compliance-fingerprint.js';

export const L53_D2_COMPLIANCE_EVIDENCE_PATH =
  '.github/l53-d2-compliance-evidence.json';

function resolveGitSha() {
  const configured = process.env.GITHUB_SHA?.trim() || process.env.GIT_SHA?.trim();
  if (configured) return configured;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function evidenceGenerationFailed(
  gitSha: string,
  checkedAt: Date,
): ComplianceReleaseEvidence {
  return {
    passed: false,
    git_sha: gitSha,
    checked_at: checkedAt.toISOString(),
    summary: {
      active_product_count: 0,
      approved_valid_count: 0,
      blocked_product_count: 1,
    },
    products: [
      {
        product_id: '__release_evaluation__',
        passed: false,
        reason_codes: ['EVIDENCE_GENERATION_FAILED'],
        current_fingerprint: null,
        approved_fingerprint: null,
        review_id: null,
      },
    ],
    rule_versions: {
      category: FIRST_LAUNCH_CATEGORY_RULE_VERSION,
      qualification: SUPPLIER_QUALIFICATION_RULE_VERSION,
      fingerprint: PRODUCT_COMPLIANCE_FINGERPRINT_VERSION,
    },
  };
}

export async function runComplianceReleaseVerification(input: {
  client?: Parameters<typeof evaluateComplianceRelease>[0];
  gitSha?: string;
  checkedAt?: Date;
  outputPath?: string;
} = {}) {
  const checkedAt = input.checkedAt ?? new Date();
  const gitSha = input.gitSha ?? resolveGitSha();
  const outputPath = resolve(
    input.outputPath ?? L53_D2_COMPLIANCE_EVIDENCE_PATH,
  );
  let evidence: ComplianceReleaseEvidence;
  if (!gitSha.trim()) {
    evidence = evidenceGenerationFailed('', checkedAt);
  } else {
    try {
      evidence = await evaluateComplianceRelease(
        input.client ?? (prisma as never),
        { gitSha, checkedAt },
      );
    } catch {
      evidence = evidenceGenerationFailed(gitSha, checkedAt);
    }
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence.passed ? 0 : 1;
}

async function main() {
  process.exitCode = await runComplianceReleaseVerification();
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
