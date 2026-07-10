ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "delivery_time_window_code" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "delivery_time_window_text" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "product_amount_cents" INTEGER;
UPDATE "Order" SET "product_amount_cents" = "total_amount_cents" WHERE "product_amount_cents" IS NULL;
