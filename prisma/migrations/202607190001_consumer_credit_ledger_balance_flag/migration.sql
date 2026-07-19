-- Repair the schema/migration drift introduced when the consumer-credit
-- balance flag was added to schema.prisma without deployable DDL.
ALTER TABLE "ConsumerCreditLedger"
  ADD COLUMN IF NOT EXISTS "affects_available_balance" BOOLEAN NOT NULL DEFAULT true;

-- Rollback (manual only):
-- ALTER TABLE "ConsumerCreditLedger" DROP COLUMN IF EXISTS "affects_available_balance";
