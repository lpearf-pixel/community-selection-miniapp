import { existsSync, readFileSync } from 'node:fs';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`L46 tax-record verifier: ${message}`);
}

const repositoryPath = 'apps/api/src/modules/tax-record/tax-record-scope-repository.ts';
const routePath = 'apps/api/src/routes/withdrawals.ts';
assert(existsSync(repositoryPath) && existsSync(routePath), 'tax record repository and route must exist');
const repository = readFileSync(repositoryPath, 'utf8');
const route = readFileSync(routePath, 'utf8');

for (const marker of ['type TaxRecordDbClient = Prisma.TransactionClient | typeof prisma', 'db.$queryRaw', 'buildScopedTaxRecordSql', 'escapeLikePattern', 'bigintToSafeNumber', 'Number.isSafeInteger', 'restoreSelectedIdOrder', 'TaxRecord hydration snapshot mismatch']) assert(repository.includes(marker), `missing ${marker}`);
assert(!/function listScopedTaxRecordIds\([^)]*\)\s*\{\s*return prisma\./.test(repository), 'repository query must use passed db client');
assert(repository.includes('EXISTS (SELECT 1 FROM "WithdrawalCommission"') && repository.includes('NOT EXISTS (SELECT 1 FROM "WithdrawalCommission"'), 'scope must require some and every linked order');
assert(repository.includes('Prisma.sql` OR `') && repository.includes('Prisma.sql`FALSE`'), 'mixed scope must OR and empty scope must fail closed');
assert(repository.includes("invoiceStatus: 'pending'") && repository.includes('w.invoice_required = true'), 'pending invoice must use invoice_required and pending status');
assert(repository.includes("'tax_review_pending' | 'invoice_pending'") && repository.includes("CASE WHEN tr.tax_status = 'pending'"), 'tax and invoice alerts must be database scoped');
assert(route.includes('prisma.$transaction(async (tx) =>') && route.includes('countScopedTaxRecords(tx') && route.includes('listScopedTaxRecordIds(tx'), 'list must select/count in a transaction');
assert(route.includes('restoreSelectedIdOrder(selectedIds, hydrated)'), 'list/export must restore selected ID order');
assert(route.includes('limit + 1') && route.includes('ensureTaxExportWithinLimit') && route.includes('x-export-total') && route.includes('x-export-truncated'), 'L45 CSV limit and headers must remain');
assert(route.includes('csvSafe') && route.includes('"\\ufeff"'), 'L45 CSV BOM and formula guard must remain');
console.log('L46 tax record transaction/scope checks passed.');
