-- L44 manual withdrawal review workbench.
-- Compatibility: all new columns are nullable so existing Withdrawal rows remain valid.
-- Rollback (manual): drop index "Withdrawal_client_request_id_key" then drop the columns added below.
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "client_request_id" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewed_by_admin_id" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "processed_by_admin_id" TEXT;
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "processed_at" TIMESTAMP(3);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
ALTER TABLE "Withdrawal" ADD COLUMN IF NOT EXISTS "manual_reference" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Withdrawal_client_request_id_key" ON "Withdrawal"("client_request_id");
