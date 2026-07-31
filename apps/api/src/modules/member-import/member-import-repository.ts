import { Prisma, type LegacyMemberImportBatch, type LegacyMemberImportRow, type LegacyMemberEligibility } from '@prisma/client';
import { prisma } from '../../db.js';
import type {
  EligibilityRecord,
  ImportBatchRecord,
  ImportRowRecord,
  MemberImportRepository,
} from './member-import-service.js';
import { fingerprintPhone, normalizeMainlandPhone } from './phone-identity.js';

function mapBatch(value: LegacyMemberImportBatch): ImportBatchRecord {
  return {
    id: value.id,
    sourceName: value.source_name,
    fileName: value.file_name,
    fileSha256: value.file_sha256,
    status: value.status,
    operatorId: value.operator_admin_id,
    confirmedBy: value.confirmed_admin_id,
    createdAt: value.created_at,
    stats: {
      total: value.total_rows,
      valid: value.valid_rows,
      duplicate: value.duplicate_rows,
      invalid: value.invalid_rows,
      matched: value.matched_rows,
      pending: value.pending_rows,
    },
  };
}

function mapRow(value: LegacyMemberImportRow): ImportRowRecord {
  return {
    id: value.id,
    batchId: value.batch_id,
    rowNumber: value.row_number,
    phoneFingerprint: value.phone_fingerprint,
    maskedPhone: value.masked_phone,
    status: value.status,
    invalidReason: value.invalid_reason,
    matchedUserId: value.matched_user_id,
  };
}

function mapEligibility(value: LegacyMemberEligibility): EligibilityRecord {
  return {
    id: value.id,
    batchId: value.batch_id,
    phoneFingerprint: value.phone_fingerprint,
    maskedPhone: value.masked_phone,
    userId: value.user_id,
    grantType: 'LEGACY_FIRST_YEAR_FREE',
    status: value.status,
  };
}

export class PrismaMemberImportRepository implements MemberImportRepository {
  async findUserMatches(fingerprints: string[], secret: string) {
    const wanted = new Set(fingerprints);
    const users = await prisma.user.findMany({
      where: { phone: { not: null }, status: 'active' },
      select: { id: true, phone: true },
    });
    const matches = new Map<string, string>();
    for (const user of users) {
      const normalized = normalizeMainlandPhone(user.phone);
      if (!normalized) continue;
      const fingerprint = fingerprintPhone(normalized, secret);
      if (wanted.has(fingerprint)) matches.set(fingerprint, user.id);
    }
    return matches;
  }

  async createPreview(input: { batch: ImportBatchRecord; rows: ImportRowRecord[] }) {
    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.legacyMemberImportBatch.create({
        data: {
          id: input.batch.id,
          source_name: input.batch.sourceName,
          file_name: input.batch.fileName,
          file_sha256: input.batch.fileSha256,
          status: input.batch.status,
          total_rows: input.batch.stats.total,
          valid_rows: input.batch.stats.valid,
          duplicate_rows: input.batch.stats.duplicate,
          invalid_rows: input.batch.stats.invalid,
          matched_rows: input.batch.stats.matched,
          pending_rows: input.batch.stats.pending,
          operator_admin_id: input.batch.operatorId,
        },
      });
      await tx.legacyMemberImportRow.createMany({
        data: input.rows.map((row) => ({
          id: row.id,
          batch_id: row.batchId,
          row_number: row.rowNumber,
          phone_fingerprint: row.phoneFingerprint,
          masked_phone: row.maskedPhone,
          status: row.status,
          invalid_reason: row.invalidReason,
          matched_user_id: row.matchedUserId,
        })),
      });
      await tx.adminAuditLog.create({
        data: {
          admin_user_id: input.batch.operatorId,
          action: 'legacy_member_import_previewed',
          target_type: 'LegacyMemberImportBatch',
          target_id: batch.id,
          payload: input.batch.stats as unknown as Prisma.InputJsonValue,
        },
      });
      return batch;
    });
    return mapBatch(created);
  }

  async getBatch(id: string) {
    const value = await prisma.legacyMemberImportBatch.findUnique({ where: { id } });
    return value ? mapBatch(value) : null;
  }

  async getRows(id: string) {
    const values = await prisma.legacyMemberImportRow.findMany({
      where: { batch_id: id },
      orderBy: { row_number: 'asc' },
    });
    return values.map(mapRow);
  }

  async listBatches() {
    const values = await prisma.legacyMemberImportBatch.findMany({
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return values.map(mapBatch);
  }

  async getEligibilities(batchId: string) {
    const values = await prisma.legacyMemberEligibility.findMany({
      where: { batch_id: batchId },
      orderBy: { created_at: 'asc' },
    });
    return values.map(mapEligibility);
  }

  async confirmBatch(id: string, actorId: string, grants: EligibilityRecord[]) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.legacyMemberImportBatch.findUnique({ where: { id } });
      if (!current) throw Object.assign(new Error('导入批次不存在'), { statusCode: 404 });
      if (current.status === 'confirmed') {
        return { batch: mapBatch(current), created: 0, skipped: grants.length };
      }
      const result = await tx.legacyMemberEligibility.createMany({
        data: grants.map((grant) => ({
          id: grant.id,
          batch_id: grant.batchId,
          phone_fingerprint: grant.phoneFingerprint,
          masked_phone: grant.maskedPhone,
          user_id: grant.userId,
          grant_type: grant.grantType,
          status: grant.status,
          claimed_at: grant.userId ? new Date() : null,
        })),
        skipDuplicates: true,
      });
      const batch = await tx.legacyMemberImportBatch.update({
        where: { id },
        data: { status: 'confirmed', confirmed_admin_id: actorId, confirmed_at: new Date() },
      });
      await tx.adminAuditLog.create({
        data: {
          admin_user_id: actorId,
          action: 'legacy_member_import_confirmed',
          target_type: 'LegacyMemberImportBatch',
          target_id: id,
          payload: { created: result.count, skipped: grants.length - result.count },
        },
      });
      return { batch: mapBatch(batch), created: result.count, skipped: grants.length - result.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async claimEligibility(phoneFingerprint: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.legacyMemberEligibility.findUnique({ where: { phone_fingerprint: phoneFingerprint } });
      if (!current || current.status === 'revoked' || current.status === 'used') return null;
      if (current.user_id && current.user_id !== userId) return null;
      const updated = await tx.legacyMemberEligibility.update({
        where: { id: current.id },
        data: { user_id: userId, status: 'active', claimed_at: current.claimed_at ?? new Date() },
      });
      return mapEligibility(updated);
    });
  }

  async revokeEligibility(id: string, actorId: string) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.legacyMemberEligibility.findUnique({ where: { id } });
      if (!current) throw Object.assign(new Error('资格不存在'), { statusCode: 404 });
      if (current.status === 'used') throw Object.assign(new Error('已使用资格不可撤销'), { statusCode: 409 });
      const updated = current.status === 'revoked' ? current : await tx.legacyMemberEligibility.update({
        where: { id },
        data: { status: 'revoked', revoked_at: new Date(), revoked_by_admin_id: actorId },
      });
      await tx.adminAuditLog.create({
        data: {
          admin_user_id: actorId,
          action: 'legacy_member_eligibility_revoked',
          target_type: 'LegacyMemberEligibility',
          target_id: id,
        },
      });
      return mapEligibility(updated);
    });
  }
}
