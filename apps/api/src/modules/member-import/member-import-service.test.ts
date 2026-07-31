import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createMemberImportService,
  type EligibilityRecord,
  type ImportBatchRecord,
  type ImportRowRecord,
  type MemberImportRepository,
} from './member-import-service.js';
import { fingerprintPhone } from './phone-identity.js';

const secret = 'member-import-test-secret-32-characters';

class MemoryRepository implements MemberImportRepository {
  batches = new Map<string, ImportBatchRecord>();
  rows = new Map<string, ImportRowRecord[]>();
  eligibilities = new Map<string, EligibilityRecord>();
  userMatches = new Map<string, string>();
  sequence = 0;

  async findUserMatches(fingerprints: string[]) {
    return new Map(
      fingerprints.flatMap((value) => {
        const user = this.userMatches.get(value);
        return user ? [[value, user] as const] : [];
      }),
    );
  }

  async createPreview(input: { batch: ImportBatchRecord; rows: ImportRowRecord[] }) {
    this.batches.set(input.batch.id, input.batch);
    this.rows.set(input.batch.id, input.rows);
    return input.batch;
  }

  async getBatch(id: string) {
    return this.batches.get(id) ?? null;
  }

  async getRows(id: string) {
    return this.rows.get(id) ?? [];
  }

  async listBatches() {
    return [...this.batches.values()];
  }

  async getEligibilities(batchId: string) {
    return [...this.eligibilities.values()].filter((item) => item.batchId === batchId);
  }

  async confirmBatch(id: string, actorId: string, grants: EligibilityRecord[]) {
    const batch = this.batches.get(id)!;
    if (batch.status === 'confirmed') return { batch, created: 0, skipped: grants.length };
    let created = 0;
    for (const grant of grants) {
      if (this.eligibilities.has(grant.phoneFingerprint)) continue;
      this.eligibilities.set(grant.phoneFingerprint, grant);
      created += 1;
    }
    const confirmed = { ...batch, status: 'confirmed' as const, confirmedBy: actorId };
    this.batches.set(id, confirmed);
    return { batch: confirmed, created, skipped: grants.length - created };
  }

  async claimEligibility(phoneFingerprint: string, userId: string) {
    const item = this.eligibilities.get(phoneFingerprint);
    if (!item || item.status === 'revoked' || item.status === 'used') return null;
    const claimed = { ...item, userId, status: 'active' as const };
    this.eligibilities.set(phoneFingerprint, claimed);
    return claimed;
  }

  async revokeEligibility(id: string) {
    const item = [...this.eligibilities.values()].find((value) => value.id === id);
    if (!item) throw Object.assign(new Error('资格不存在'), { statusCode: 404 });
    if (item.status === 'used') throw Object.assign(new Error('已使用资格不可撤销'), { statusCode: 409 });
    const revoked = { ...item, status: 'revoked' as const };
    this.eligibilities.set(item.phoneFingerprint, revoked);
    return revoked;
  }
}

function input(phones: string[]) {
  return {
    sourceName: '线下门店 2026-07 台账',
    fileName: 'members.csv',
    fileSha256: createHash('sha256').update(phones.join(',')).digest('hex'),
    operatorId: 'admin-1',
    rows: phones.map((rawPhone, index) => ({ rowNumber: index + 2, rawPhone })),
  };
}

describe('legacy member import service', () => {
  it('previews invalid and within-file duplicate rows without exposing full phones', async () => {
    const repo = new MemoryRepository();
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    const result = await service.preview(input(['13800138000', '13800138000', 'bad']));
    expect(result.stats).toEqual({ total: 3, valid: 1, duplicate: 1, invalid: 1, matched: 0, pending: 1 });
    expect(result.rows.map((row) => row.status)).toEqual(['pending', 'duplicate', 'invalid']);
    expect(JSON.stringify(result)).not.toContain('13800138000');
    expect(result.rows[0]?.maskedPhone).toBe('138****8000');
  });

  it('marks an account-phone match but never considers order recipient phones', async () => {
    const repo = new MemoryRepository();
    repo.userMatches.set(fingerprintPhone('13800138000', secret), 'user-1');
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    const result = await service.preview(input(['13800138000', '13900139000']));
    expect(result.stats.matched).toBe(1);
    expect(result.rows[0]).toMatchObject({ status: 'matched', matchedUserId: 'user-1' });
    expect(result.rows[1]).toMatchObject({ status: 'pending', matchedUserId: null });
  });

  it('confirms once and remains idempotent across repeated confirmation', async () => {
    const repo = new MemoryRepository();
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    const preview = await service.preview(input(['13800138000']));
    await expect(service.confirm(preview.id, 'admin-2')).resolves.toMatchObject({ created: 1, skipped: 0 });
    await expect(service.confirm(preview.id, 'admin-2')).resolves.toMatchObject({ created: 0, skipped: 1 });
    expect(repo.eligibilities.size).toBe(1);
  });

  it('deduplicates the same phone across separate batches', async () => {
    const repo = new MemoryRepository();
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    const first = await service.preview(input(['13800138000']));
    const second = await service.preview({ ...input(['13800138000']), fileSha256: 'f'.repeat(64) });
    await service.confirm(first.id, 'admin-2');
    await expect(service.confirm(second.id, 'admin-2')).resolves.toMatchObject({ created: 0, skipped: 1 });
  });

  it('claims a pending eligibility only after a verified account phone is supplied', async () => {
    const repo = new MemoryRepository();
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    const preview = await service.preview(input(['13800138000']));
    await service.confirm(preview.id, 'admin-2');
    await expect(service.claimVerifiedPhone('user-9', '+86 138-0013-8000')).resolves.toMatchObject({ userId: 'user-9', status: 'active' });
  });

  it('rejects invalid claim phones and used-eligibility revocation', async () => {
    const repo = new MemoryRepository();
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    await expect(service.claimVerifiedPhone('user-9', 'bad')).rejects.toThrow('手机号');
    const preview = await service.preview(input(['13800138000']));
    await service.confirm(preview.id, 'admin-2');
    const eligibility = [...repo.eligibilities.values()][0]!;
    repo.eligibilities.set(eligibility.phoneFingerprint, { ...eligibility, status: 'used' });
    await expect(service.revoke(eligibility.id, 'admin-2')).rejects.toThrow('不可撤销');
  });

  it('returns masked eligibility actions in confirmed batch detail', async () => {
    const repo = new MemoryRepository();
    const service = createMemberImportService(repo, { secret, id: () => `id-${++repo.sequence}` });
    const preview = await service.preview(input(['13800138000']));
    await service.confirm(preview.id, 'admin-2');
    await expect(service.detail(preview.id)).resolves.toMatchObject({
      eligibilities: [{ maskedPhone: '138****8000', status: 'pending' }],
    });
  });
});
