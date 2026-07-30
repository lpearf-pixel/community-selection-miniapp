import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const evaluator = vi.hoisted(() => ({
  evaluate: vi.fn(),
}));

vi.mock('../apps/api/src/modules/compliance/compliance-release-evaluator.js', () => ({
  evaluateComplianceRelease: evaluator.evaluate,
}));
vi.mock('../apps/api/src/db.js', () => ({ prisma: { source: 'mock' } }));

import { runComplianceReleaseVerification } from './verify-l53-d2-compliance-release-local.js';

const evidence = (passed: boolean) => ({
  passed,
  git_sha: 'abc123',
  checked_at: '2026-07-30T06:00:00.000Z',
  summary: {
    active_product_count: 1,
    approved_valid_count: passed ? 1 : 0,
    blocked_product_count: passed ? 0 : 1,
  },
  products: [],
  rule_versions: {
    category: 'l53-d2-category-v1',
    qualification: 'l53-d2-supplier-qualification-v1',
    fingerprint: 'l53-d2-product-compliance-v2',
  },
});

describe('runComplianceReleaseVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [true, 0],
    [false, 1],
  ])('writes evidence when passed=%s and returns %i', async (passed, exitCode) => {
    evaluator.evaluate.mockResolvedValueOnce(evidence(passed));
    const directory = await mkdtemp(join(tmpdir(), 'l53-d2-evidence-'));
    const outputPath = join(directory, 'evidence.json');

    await expect(
      runComplianceReleaseVerification({
        client: { source: 'mock' } as never,
        gitSha: 'abc123',
        checkedAt: new Date('2026-07-30T06:00:00.000Z'),
        outputPath,
      }),
    ).resolves.toBe(exitCode);

    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(
      evidence(passed),
    );
  });

  it('fails closed and writes evidence when Git SHA is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'l53-d2-evidence-'));
    const outputPath = join(directory, 'evidence.json');

    await expect(
      runComplianceReleaseVerification({
        client: { source: 'mock' } as never,
        gitSha: '',
        checkedAt: new Date('2026-07-30T06:00:00.000Z'),
        outputPath,
      }),
    ).resolves.toBe(1);

    const output = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(output.passed).toBe(false);
    expect(output.products[0].reason_codes).toEqual([
      'EVIDENCE_GENERATION_FAILED',
    ]);
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it('writes fail-closed evidence when the evaluator rejects unexpectedly', async () => {
    evaluator.evaluate.mockRejectedValueOnce(new Error('unexpected failure'));
    const directory = await mkdtemp(join(tmpdir(), 'l53-d2-evidence-'));
    const outputPath = join(directory, 'evidence.json');

    await expect(
      runComplianceReleaseVerification({
        client: { source: 'mock' } as never,
        gitSha: 'abc123',
        checkedAt: new Date('2026-07-30T06:00:00.000Z'),
        outputPath,
      }),
    ).resolves.toBe(1);

    const output = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(output).toMatchObject({
      passed: false,
      git_sha: 'abc123',
      products: [
        {
          product_id: '__release_evaluation__',
          reason_codes: ['EVIDENCE_GENERATION_FAILED'],
        },
      ],
    });
  });
});
