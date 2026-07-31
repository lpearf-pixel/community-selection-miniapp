ALTER TABLE "Category" ADD COLUMN "compliance_code" TEXT;
ALTER TABLE "Product" ADD COLUMN "primary_supplier_id" TEXT;
ALTER TABLE "Product" ADD COLUMN "origin_text" TEXT;
ALTER TABLE "Product" ADD COLUMN "labels" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Supplier" ADD COLUMN "subject_type" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "source_address" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "market_name" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "stall_no" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "profile_fingerprint" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "profile_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProductBatch" ADD COLUMN "origin_text" TEXT;

CREATE TABLE "SupplierQualification" (
  "id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "qualification_type" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "object_key" TEXT NOT NULL,
  "file_sha256" TEXT NOT NULL,
  "issued_at" TIMESTAMP(3),
  "valid_from" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "masked_summary" JSONB NOT NULL,
  "critical_fingerprint" TEXT NOT NULL,
  "submitted_by_admin_id" TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_admin_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "revoked_by_admin_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoke_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierQualification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductBatchEvidence" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "object_key" TEXT,
  "file_sha256" TEXT,
  "payment_reference_hash" TEXT,
  "invoice_evidence_status" TEXT,
  "issued_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "masked_summary" JSONB NOT NULL,
  "evidence_fingerprint" TEXT NOT NULL,
  "created_by_admin_id" TEXT NOT NULL,
  "revoked_by_admin_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoke_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductBatchEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductComplianceReview" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "compliance_fingerprint" TEXT NOT NULL,
  "fingerprint_version" TEXT NOT NULL,
  "category_rule_version" TEXT NOT NULL,
  "qualification_rule_version" TEXT NOT NULL,
  "product_snapshot" JSONB NOT NULL,
  "supplier_snapshot" JSONB NOT NULL,
  "qualification_snapshot" JSONB NOT NULL,
  "batch_evidence_snapshot" JSONB NOT NULL,
  "submitted_by_admin_id" TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3) NOT NULL,
  "reviewed_by_admin_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "invalidated_at" TIMESTAMP(3),
  "invalidation_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductComplianceReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ComplianceEvidenceAccessLog" (
  "id" TEXT NOT NULL,
  "admin_user_id" TEXT NOT NULL,
  "evidence_type" TEXT NOT NULL,
  "evidence_id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplianceEvidenceAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Category_compliance_code_idx" ON "Category"("compliance_code");
CREATE INDEX "Product_primary_supplier_id_idx" ON "Product"("primary_supplier_id");
CREATE INDEX "Supplier_subject_type_idx" ON "Supplier"("subject_type");
CREATE UNIQUE INDEX "SupplierQualification_supplier_id_qualification_type_version_key"
  ON "SupplierQualification"("supplier_id", "qualification_type", "version");
CREATE INDEX "SupplierQualification_supplier_id_status_idx"
  ON "SupplierQualification"("supplier_id", "status");
CREATE INDEX "SupplierQualification_status_expires_at_idx"
  ON "SupplierQualification"("status", "expires_at");
CREATE INDEX "SupplierQualification_critical_fingerprint_idx"
  ON "SupplierQualification"("critical_fingerprint");
CREATE INDEX "ProductBatchEvidence_batch_id_status_idx"
  ON "ProductBatchEvidence"("batch_id", "status");
CREATE INDEX "ProductBatchEvidence_status_expires_at_idx"
  ON "ProductBatchEvidence"("status", "expires_at");
CREATE INDEX "ProductBatchEvidence_evidence_fingerprint_idx"
  ON "ProductBatchEvidence"("evidence_fingerprint");
CREATE INDEX "ProductComplianceReview_product_id_status_created_at_idx"
  ON "ProductComplianceReview"("product_id", "status", "created_at");
CREATE INDEX "ProductComplianceReview_compliance_fingerprint_idx"
  ON "ProductComplianceReview"("compliance_fingerprint");
CREATE INDEX "ComplianceEvidenceAccessLog_admin_user_id_created_at_idx"
  ON "ComplianceEvidenceAccessLog"("admin_user_id", "created_at");
CREATE INDEX "ComplianceEvidenceAccessLog_evidence_type_evidence_id_idx"
  ON "ComplianceEvidenceAccessLog"("evidence_type", "evidence_id");
CREATE INDEX "ComplianceEvidenceAccessLog_outcome_created_at_idx"
  ON "ComplianceEvidenceAccessLog"("outcome", "created_at");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_primary_supplier_id_fkey"
  FOREIGN KEY ("primary_supplier_id") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierQualification"
  ADD CONSTRAINT "SupplierQualification_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductBatchEvidence"
  ADD CONSTRAINT "ProductBatchEvidence_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "ProductBatch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductComplianceReview"
  ADD CONSTRAINT "ProductComplianceReview_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
