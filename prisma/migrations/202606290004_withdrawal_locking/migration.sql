ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'withdrawing';
ALTER TABLE "Commission" ADD COLUMN "withdrawal_id" TEXT;
CREATE INDEX "Commission_withdrawal_id_idx" ON "Commission"("withdrawal_id");
