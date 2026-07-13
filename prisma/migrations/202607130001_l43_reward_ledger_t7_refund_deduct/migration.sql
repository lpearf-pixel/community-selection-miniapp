-- L43 reward ledger T+7 and refund deduction enhancements.
ALTER TABLE "Commission"
  ADD COLUMN IF NOT EXISTS "review_status" TEXT NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS "review_note" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_by_admin_id" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_adjusted_at" TIMESTAMP(3);

ALTER TABLE "RewardLedger"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "event_type" TEXT NOT NULL DEFAULT 'legacy_reward_event',
  ADD COLUMN IF NOT EXISTS "affects_available_balance" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "effective_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refund_id" TEXT,
  ADD COLUMN IF NOT EXISTS "amount_before_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "amount_after_cents" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "RewardLedger_idempotency_key_key" ON "RewardLedger"("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "RewardLedger_affects_available_balance_idx" ON "RewardLedger"("affects_available_balance");
CREATE INDEX IF NOT EXISTS "Commission_review_status_idx" ON "Commission"("review_status");

-- Rollback: drop indexes above, then drop the added nullable/defaulted columns. Historical rows are preserved by default.
