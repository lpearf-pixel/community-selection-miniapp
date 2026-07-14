-- L44 follow-up: persist Withdrawal-Commission composition independently from Commission.withdrawal_id.
-- Compatible and idempotent: creates a link table and backfills rows for commissions that still carry withdrawal_id.
-- Rollback (manual): DROP TABLE "WithdrawalCommission"; no historical Withdrawal/Commission rows are modified.
CREATE TABLE IF NOT EXISTS "WithdrawalCommission" (
  "id" TEXT NOT NULL,
  "withdrawal_id" TEXT NOT NULL,
  "commission_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WithdrawalCommission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WithdrawalCommission_withdrawal_id_commission_id_key" ON "WithdrawalCommission"("withdrawal_id", "commission_id");
CREATE INDEX IF NOT EXISTS "WithdrawalCommission_withdrawal_id_idx" ON "WithdrawalCommission"("withdrawal_id");
CREATE INDEX IF NOT EXISTS "WithdrawalCommission_commission_id_idx" ON "WithdrawalCommission"("commission_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WithdrawalCommission_withdrawal_id_fkey') THEN
    ALTER TABLE "WithdrawalCommission" ADD CONSTRAINT "WithdrawalCommission_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WithdrawalCommission_commission_id_fkey') THEN
    ALTER TABLE "WithdrawalCommission" ADD CONSTRAINT "WithdrawalCommission_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "WithdrawalCommission" ("id", "withdrawal_id", "commission_id", "amount_cents", "created_at")
SELECT 'wcl_' || md5(c."withdrawal_id" || ':' || c."id"), c."withdrawal_id", c."id", c."final_amount_cents", CURRENT_TIMESTAMP
FROM "Commission" c
WHERE c."withdrawal_id" IS NOT NULL
ON CONFLICT ("withdrawal_id", "commission_id") DO NOTHING;
