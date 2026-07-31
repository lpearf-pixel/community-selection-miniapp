CREATE TYPE "MemberImportBatchStatus" AS ENUM ('preview', 'confirmed');
CREATE TYPE "MemberImportRowStatus" AS ENUM ('invalid', 'duplicate', 'matched', 'pending');
CREATE TYPE "LegacyMemberEligibilityStatus" AS ENUM ('pending', 'active', 'used', 'revoked');

CREATE TABLE "LegacyMemberImportBatch" (
  "id" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_sha256" TEXT NOT NULL,
  "status" "MemberImportBatchStatus" NOT NULL DEFAULT 'preview',
  "total_rows" INTEGER NOT NULL,
  "valid_rows" INTEGER NOT NULL,
  "duplicate_rows" INTEGER NOT NULL,
  "invalid_rows" INTEGER NOT NULL,
  "matched_rows" INTEGER NOT NULL,
  "pending_rows" INTEGER NOT NULL,
  "operator_admin_id" TEXT NOT NULL,
  "confirmed_admin_id" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMemberImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegacyMemberImportRow" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "row_number" INTEGER NOT NULL,
  "phone_fingerprint" TEXT,
  "masked_phone" TEXT,
  "status" "MemberImportRowStatus" NOT NULL,
  "invalid_reason" TEXT,
  "matched_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMemberImportRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegacyMemberEligibility" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "phone_fingerprint" TEXT NOT NULL,
  "masked_phone" TEXT NOT NULL,
  "user_id" TEXT,
  "grant_type" TEXT NOT NULL DEFAULT 'LEGACY_FIRST_YEAR_FREE',
  "status" "LegacyMemberEligibilityStatus" NOT NULL DEFAULT 'pending',
  "claimed_at" TIMESTAMP(3),
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "revoked_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LegacyMemberEligibility_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegacyMemberImportBatch_status_created_at_idx" ON "LegacyMemberImportBatch"("status", "created_at");
CREATE INDEX "LegacyMemberImportBatch_file_sha256_idx" ON "LegacyMemberImportBatch"("file_sha256");
CREATE UNIQUE INDEX "LegacyMemberImportRow_batch_id_row_number_key" ON "LegacyMemberImportRow"("batch_id", "row_number");
CREATE INDEX "LegacyMemberImportRow_batch_id_status_idx" ON "LegacyMemberImportRow"("batch_id", "status");
CREATE INDEX "LegacyMemberImportRow_phone_fingerprint_idx" ON "LegacyMemberImportRow"("phone_fingerprint");
CREATE UNIQUE INDEX "LegacyMemberEligibility_phone_fingerprint_key" ON "LegacyMemberEligibility"("phone_fingerprint");
CREATE UNIQUE INDEX "LegacyMemberEligibility_user_id_key" ON "LegacyMemberEligibility"("user_id");
CREATE INDEX "LegacyMemberEligibility_batch_id_status_idx" ON "LegacyMemberEligibility"("batch_id", "status");
CREATE INDEX "LegacyMemberEligibility_status_created_at_idx" ON "LegacyMemberEligibility"("status", "created_at");

ALTER TABLE "LegacyMemberImportRow" ADD CONSTRAINT "LegacyMemberImportRow_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "LegacyMemberImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyMemberImportRow" ADD CONSTRAINT "LegacyMemberImportRow_matched_user_id_fkey" FOREIGN KEY ("matched_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegacyMemberEligibility" ADD CONSTRAINT "LegacyMemberEligibility_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "LegacyMemberImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacyMemberEligibility" ADD CONSTRAINT "LegacyMemberEligibility_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
