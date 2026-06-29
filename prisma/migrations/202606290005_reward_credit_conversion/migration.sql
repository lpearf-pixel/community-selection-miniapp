ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'converted';
ALTER TABLE "Order" ADD COLUMN "credit_amount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "credit_source_type" TEXT;
ALTER TABLE "Order" ADD COLUMN "credit_source_id" TEXT;

CREATE TABLE "TaxRecord" (
  "id" TEXT NOT NULL,
  "leader_user_id" TEXT,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "tax_mode" TEXT NOT NULL,
  "tax_status" TEXT NOT NULL DEFAULT 'pending_review',
  "amount_cents" INTEGER NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxRecord_source_type_source_id_key" ON "TaxRecord"("source_type", "source_id");
CREATE INDEX "TaxRecord_leader_user_id_idx" ON "TaxRecord"("leader_user_id");
CREATE INDEX "TaxRecord_tax_status_idx" ON "TaxRecord"("tax_status");

CREATE TABLE "RewardConversion" (
  "id" TEXT NOT NULL,
  "leader_user_id" TEXT NOT NULL,
  "commission_id" TEXT NOT NULL,
  "client_request_id" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "conversion_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'success',
  "tax_status" TEXT NOT NULL DEFAULT 'pending_review',
  "tax_record_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardConversion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RewardConversion_client_request_id_key" ON "RewardConversion"("client_request_id");
CREATE INDEX "RewardConversion_leader_user_id_idx" ON "RewardConversion"("leader_user_id");
CREATE INDEX "RewardConversion_commission_id_idx" ON "RewardConversion"("commission_id");
CREATE INDEX "RewardConversion_tax_status_idx" ON "RewardConversion"("tax_status");

CREATE TABLE "RewardLedger" (
  "id" TEXT NOT NULL,
  "leader_user_id" TEXT NOT NULL,
  "commission_id" TEXT,
  "withdrawal_id" TEXT,
  "conversion_id" TEXT,
  "entry_type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "balance_after_cents" INTEGER NOT NULL,
  "tax_status" TEXT NOT NULL DEFAULT 'pending_review',
  "tax_record_id" TEXT,
  "order_id" TEXT,
  "remark" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardLedger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RewardLedger_leader_user_id_idx" ON "RewardLedger"("leader_user_id");
CREATE INDEX "RewardLedger_commission_id_idx" ON "RewardLedger"("commission_id");
CREATE INDEX "RewardLedger_order_id_idx" ON "RewardLedger"("order_id");

CREATE TABLE "ConsumerCreditLedger" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "balance_after_cents" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3),
  "usable_scope" TEXT,
  "remark" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsumerCreditLedger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConsumerCreditLedger_user_id_idx" ON "ConsumerCreditLedger"("user_id");
CREATE INDEX "ConsumerCreditLedger_source_type_source_id_idx" ON "ConsumerCreditLedger"("source_type", "source_id");
