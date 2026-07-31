import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migrationPath = resolve(
  root,
  'prisma/migrations/202607290002_l53_d2_product_compliance/migration.sql',
);

describe('L53-D2 additive compliance persistence contract', () => {
  it('extends the existing category, product, supplier, and batch models', () => {
    for (const field of [
      'compliance_code',
      'primary_supplier_id',
      'origin_text',
      'labels',
      'subject_type',
      'source_address',
      'profile_fingerprint',
      'profile_version',
      'qualifications',
      'compliance_reviews',
      'compliance_evidence',
    ]) {
      expect(schema, `missing additive field ${field}`).toContain(field);
    }
  });

  it('defines immutable qualification, batch evidence, review, and access audit records', () => {
    for (const model of [
      'model SupplierQualification',
      'model ProductBatchEvidence',
      'model ProductComplianceReview',
      'model ComplianceEvidenceAccessLog',
    ]) {
      expect(schema, `missing ${model}`).toContain(model);
    }
    expect(schema).toContain('@@index([product_id, status, created_at])');
    expect(schema).toContain('@@unique([supplier_id, qualification_type, version])');
  });

  it('uses an additive migration that neither delists products nor fabricates approvals', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/i);
    expect(sql).not.toMatch(
      /UPDATE\s+"Product"\s+SET\s+"status"/i,
    );
    expect(sql).not.toMatch(
      /INSERT\s+INTO\s+"ProductComplianceReview"/i,
    );
    expect(sql).toContain(
      'ALTER TABLE "Category" ADD COLUMN "compliance_code" TEXT',
    );
    expect(sql).toContain('CREATE TABLE "ProductComplianceReview"');
    expect(sql).toContain('CREATE TABLE "ComplianceEvidenceAccessLog"');
  });
});
