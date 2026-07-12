ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "event_type" TEXT NOT NULL DEFAULT 'legacy_stock_event';
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "quantity_delta" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "order_id" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "refund_id" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN IF NOT EXISTS "after_sale_case_id" TEXT;

UPDATE "StockLedger"
SET "quantity_delta" = CASE WHEN "direction" = 'out' THEN -ABS("quantity") ELSE ABS("quantity") END
WHERE "quantity_delta" = 0 AND "quantity" <> 0;

CREATE UNIQUE INDEX IF NOT EXISTS "StockLedger_idempotency_key_key" ON "StockLedger"("idempotency_key");
CREATE INDEX IF NOT EXISTS "StockLedger_order_id_idx" ON "StockLedger"("order_id");
CREATE INDEX IF NOT EXISTS "StockLedger_refund_id_idx" ON "StockLedger"("refund_id");
CREATE INDEX IF NOT EXISTS "StockLedger_event_type_idx" ON "StockLedger"("event_type");
