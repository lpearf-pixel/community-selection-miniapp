import { randomUUID } from 'node:crypto';
import type { ParsedMemberRow } from './member-file-parser.js';
import { fingerprintPhone, maskPhone, normalizeMainlandPhone } from './phone-identity.js';

export type ImportRowStatus = 'invalid' | 'duplicate' | 'matched' | 'pending';
export type EligibilityStatus = 'pending' | 'active' | 'used' | 'revoked';

export type ImportStats = {
  total: number;
  valid: number;
  duplicate: number;
  invalid: number;
  matched: number;
  pending: number;
};

export type ImportBatchRecord = {
  id: string;
  sourceName: string;
  fileName: string;
  fileSha256: string;
  status: 'preview' | 'confirmed';
  operatorId: string;
  confirmedBy: string | null;
  createdAt: Date;
  stats: ImportStats;
};

export type ImportRowRecord = {
  id: string;
  batchId: string;
  rowNumber: number;
  phoneFingerprint: string | null;
  maskedPhone: string | null;
  status: ImportRowStatus;
  invalidReason: string | null;
  matchedUserId: string | null;
};

export type EligibilityRecord = {
  id: string;
  batchId: string;
  phoneFingerprint: string;
  maskedPhone: string;
  userId: string | null;
  grantType: 'LEGACY_FIRST_YEAR_FREE';
  status: EligibilityStatus;
};

export interface MemberImportRepository {
  findUserMatches(fingerprints: string[], secret: string): Promise<Map<string, string>>;
  createPreview(input: { batch: ImportBatchRecord; rows: ImportRowRecord[] }): Promise<ImportBatchRecord>;
  getBatch(id: string): Promise<ImportBatchRecord | null>;
  getRows(id: string): Promise<ImportRowRecord[]>;
  listBatches(): Promise<ImportBatchRecord[]>;
  getEligibilities(batchId: string): Promise<EligibilityRecord[]>;
  confirmBatch(
    id: string,
    actorId: string,
    grants: EligibilityRecord[],
  ): Promise<{ batch: ImportBatchRecord; created: number; skipped: number }>;
  claimEligibility(phoneFingerprint: string, userId: string): Promise<EligibilityRecord | null>;
  revokeEligibility(id: string, actorId: string): Promise<EligibilityRecord>;
}

type PreviewInput = {
  sourceName: string;
  fileName: string;
  fileSha256: string;
  operatorId: string;
  rows: ParsedMemberRow[];
};

export function createMemberImportService(
  repository: MemberImportRepository,
  options: { secret: string; id?: () => string },
) {
  const nextId = options.id ?? randomUUID;

  async function preview(input: PreviewInput) {
    if (!input.sourceName.trim()) throw Object.assign(new Error('来源说明不能为空'), { statusCode: 400 });
    if (!/^[a-f0-9]{64}$/i.test(input.fileSha256)) throw Object.assign(new Error('文件哈希无效'), { statusCode: 400 });

    const batchId = nextId();
    const seen = new Set<string>();
    const rows: ImportRowRecord[] = input.rows.map((row) => {
      const normalized = normalizeMainlandPhone(row.rawPhone);
      if (!normalized) {
        return {
          id: nextId(), batchId, rowNumber: row.rowNumber,
          phoneFingerprint: null, maskedPhone: null, status: 'invalid',
          invalidReason: '手机号格式无效', matchedUserId: null,
        };
      }
      const phoneFingerprint = fingerprintPhone(normalized, options.secret);
      const duplicate = seen.has(phoneFingerprint);
      seen.add(phoneFingerprint);
      return {
        id: nextId(), batchId, rowNumber: row.rowNumber, phoneFingerprint,
        maskedPhone: maskPhone(normalized),
        status: duplicate ? 'duplicate' : 'pending',
        invalidReason: duplicate ? '同一文件内手机号重复' : null,
        matchedUserId: null,
      };
    });

    const candidates = rows.filter((row) => row.status === 'pending' && row.phoneFingerprint);
    const matches = await repository.findUserMatches(
      candidates.map((row) => row.phoneFingerprint!),
      options.secret,
    );
    for (const row of candidates) {
      const matchedUserId = matches.get(row.phoneFingerprint!);
      if (matchedUserId) {
        row.status = 'matched';
        row.matchedUserId = matchedUserId;
      }
    }
    const stats: ImportStats = {
      total: rows.length,
      valid: rows.filter((row) => row.status === 'matched' || row.status === 'pending').length,
      duplicate: rows.filter((row) => row.status === 'duplicate').length,
      invalid: rows.filter((row) => row.status === 'invalid').length,
      matched: rows.filter((row) => row.status === 'matched').length,
      pending: rows.filter((row) => row.status === 'pending').length,
    };
    const batch: ImportBatchRecord = {
      id: batchId,
      sourceName: input.sourceName.trim(),
      fileName: input.fileName,
      fileSha256: input.fileSha256.toLowerCase(),
      status: 'preview',
      operatorId: input.operatorId,
      confirmedBy: null,
      createdAt: new Date(),
      stats,
    };
    await repository.createPreview({ batch, rows });
    return { ...batch, rows };
  }

  async function confirm(id: string, actorId: string) {
    const batch = await repository.getBatch(id);
    if (!batch) throw Object.assign(new Error('导入批次不存在'), { statusCode: 404 });
    const rows = await repository.getRows(id);
    const grants = rows.flatMap((row): EligibilityRecord[] => {
      if (!row.phoneFingerprint || !row.maskedPhone || !['matched', 'pending'].includes(row.status)) return [];
      return [{
        id: nextId(), batchId: id, phoneFingerprint: row.phoneFingerprint,
        maskedPhone: row.maskedPhone, userId: row.matchedUserId,
        grantType: 'LEGACY_FIRST_YEAR_FREE',
        status: row.matchedUserId ? 'active' : 'pending',
      }];
    });
    return repository.confirmBatch(id, actorId, grants);
  }

  async function claimVerifiedPhone(userId: string, rawPhone: string) {
    const normalized = normalizeMainlandPhone(rawPhone);
    if (!normalized) throw Object.assign(new Error('手机号格式无效'), { statusCode: 400 });
    return repository.claimEligibility(
      fingerprintPhone(normalized, options.secret),
      userId,
    );
  }

  return {
    preview,
    confirm,
    claimVerifiedPhone,
    revoke: (id: string, actorId: string) => repository.revokeEligibility(id, actorId),
    list: () => repository.listBatches(),
    detail: async (id: string) => {
      const batch = await repository.getBatch(id);
      if (!batch) throw Object.assign(new Error('导入批次不存在'), { statusCode: 404 });
      return {
        ...batch,
        rows: await repository.getRows(id),
        eligibilities: await repository.getEligibilities(id),
      };
    },
  };
}
