import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { TaxRecordAdminScope, TaxRecordScopeFilters } from './tax-record-scope-types.js';

export type TaxRecordDbClient = Prisma.TransactionClient | typeof prisma;
export type ScopedTaxAlertRow = {
  taxRecordId: string;
  withdrawalId: string;
  alertType: 'tax_review_pending' | 'invoice_pending';
  occurredAt: Date;
};

export function escapeLikePattern(value: string) { return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_'); }
export function bigintToSafeNumber(value: bigint | number | string, label: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds JavaScript safe integer range`);
  return result;
}
export function restoreSelectedIdOrder<T extends { id: string }>(ids: readonly string[], rows: readonly T[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sorted = ids.map((id) => byId.get(id));
  if (sorted.some((row) => !row)) throw new Error('TaxRecord hydration snapshot mismatch');
  return sorted as T[];
}

export function buildScopedTaxRecordSql(scope: TaxRecordAdminScope, filters: TaxRecordScopeFilters) {
  if (filters.createdAtToInclusive && filters.createdAtToExclusive) throw new Error('TaxRecord time filter cannot contain both inclusive and exclusive to');
  const parts: Prisma.Sql[] = [Prisma.sql`tr.source_type = ${filters.sourceType}`];
  if (!scope.isSuperAdmin) {
    if (!scope.communityIds.length && !scope.pickupStoreIds.length) parts.push(Prisma.sql`FALSE`);
    else {
      const allowed = Prisma.join([
        scope.communityIds.length ? Prisma.sql`o.community_id IN (${Prisma.join(scope.communityIds)})` : Prisma.sql`FALSE`,
        scope.pickupStoreIds.length ? Prisma.sql`o.pickup_store_id IN (${Prisma.join(scope.pickupStoreIds)})` : Prisma.sql`FALSE`,
      ], Prisma.sql` OR `);
      // Every linked order must be authorized, and a withdrawal without orders is never visible.
      parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "WithdrawalCommission" wc WHERE wc.withdrawal_id = w.id)`);
      parts.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "WithdrawalCommission" wc JOIN "Commission" c ON c.id = wc.commission_id JOIN "Order" o ON o.id = c.order_id WHERE wc.withdrawal_id = w.id AND NOT (${allowed}))`);
    }
  }
  if (filters.taxMode) parts.push(Prisma.sql`tr.tax_mode = ${filters.taxMode}`);
  if (filters.taxStatus) parts.push(Prisma.sql`tr.tax_status = ${filters.taxStatus}`);
  if (filters.invoiceStatus) parts.push(Prisma.sql`w.invoice_status = ${filters.invoiceStatus}`);
  if (filters.leaderUserId) parts.push(Prisma.sql`w.leader_user_id = ${filters.leaderUserId}`);
  if (filters.withdrawalId) parts.push(Prisma.sql`w.id = ${filters.withdrawalId}`);
  if (filters.createdAtFromInclusive) parts.push(Prisma.sql`tr.created_at >= ${filters.createdAtFromInclusive}`);
  if (filters.createdAtToInclusive) parts.push(Prisma.sql`tr.created_at <= ${filters.createdAtToInclusive}`);
  if (filters.createdAtToExclusive) parts.push(Prisma.sql`tr.created_at < ${filters.createdAtToExclusive}`);
  if (filters.keyword) {
    const keyword = `%${escapeLikePattern(filters.keyword)}%`;
    parts.push(Prisma.sql`(w.id ILIKE ${keyword} ESCAPE '\\' OR w.client_request_id ILIKE ${keyword} ESCAPE '\\' OR u.nickname ILIKE ${keyword} ESCAPE '\\' OR u.phone ILIKE ${keyword} ESCAPE '\\')`);
  }
  return Prisma.join(parts, Prisma.sql` AND `);
}

const base = (scope: TaxRecordAdminScope, filters: TaxRecordScopeFilters) => Prisma.sql`
  FROM "TaxRecord" tr
  JOIN "Withdrawal" w ON tr.source_id = w.id
  LEFT JOIN "User" u ON u.id = w.leader_user_id
  WHERE ${buildScopedTaxRecordSql(scope, filters)}`;

export async function listScopedTaxRecordIds(db: TaxRecordDbClient, scope: TaxRecordAdminScope, filters: TaxRecordScopeFilters, skip = 0, take = 50) {
  return db.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT tr.id ${base(scope, filters)} ORDER BY tr.created_at DESC, tr.id DESC OFFSET ${skip} LIMIT ${take}`);
}
export async function countScopedTaxRecords(db: TaxRecordDbClient, scope: TaxRecordAdminScope, filters: TaxRecordScopeFilters) {
  const result = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count ${base(scope, filters)}`);
  return bigintToSafeNumber(result[0]?.count ?? 0, 'tax record count');
}
export const listScopedTaxRecordsForExport = listScopedTaxRecordIds;
export function countScopedPendingTaxReviews(db: TaxRecordDbClient, scope: TaxRecordAdminScope, filters: Omit<TaxRecordScopeFilters, 'taxStatus'>) {
  return countScopedTaxRecords(db, scope, { ...filters, taxStatus: 'pending' });
}
export async function countScopedPendingInvoices(db: TaxRecordDbClient, scope: TaxRecordAdminScope, filters: TaxRecordScopeFilters) {
  const result = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count ${base(scope, { ...filters, invoiceStatus: 'pending' })} AND w.invoice_required = true`);
  return bigintToSafeNumber(result[0]?.count ?? 0, 'pending invoice count');
}
export async function listScopedTaxAlerts(db: TaxRecordDbClient, scope: TaxRecordAdminScope, filters: TaxRecordScopeFilters, take = 50): Promise<ScopedTaxAlertRow[]> {
  return db.$queryRaw<ScopedTaxAlertRow[]>(Prisma.sql`
    SELECT * FROM (
      SELECT tr.id AS "taxRecordId", w.id AS "withdrawalId", 'tax_review_pending' AS "alertType", tr.created_at AS "occurredAt"
      ${base(scope, filters)} AND tr.tax_status = 'pending'
      UNION ALL
      SELECT tr.id AS "taxRecordId", w.id AS "withdrawalId", 'invoice_pending' AS "alertType", tr.created_at AS "occurredAt"
      ${base(scope, filters)} AND w.invoice_required = true AND w.invoice_status = 'pending'
    ) alerts
    ORDER BY "occurredAt" DESC, "withdrawalId" ASC, "taxRecordId" ASC, "alertType" ASC
    LIMIT ${take}`);
}
