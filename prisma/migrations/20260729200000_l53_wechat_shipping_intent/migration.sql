CREATE TYPE "WechatShippingIntentStatus" AS ENUM (
  'pending',
  'processing',
  'retryable',
  'succeeded',
  'manual_required'
);

CREATE TYPE "WechatShippingTrigger" AS ENUM (
  'delivery_started',
  'pickup_verified'
);

CREATE TABLE "WechatShippingIntent" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "trigger" "WechatShippingTrigger" NOT NULL,
  "logistics_type" INTEGER NOT NULL,
  "status" "WechatShippingIntentStatus" NOT NULL DEFAULT 'pending',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" TEXT,
  "next_retry_at" TIMESTAMP(3),
  "succeeded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WechatShippingIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WechatShippingIntent_logistics_type_check"
    CHECK ("logistics_type" IN (2, 4))
);

CREATE UNIQUE INDEX "WechatShippingIntent_order_id_key"
ON "WechatShippingIntent"("order_id");

CREATE INDEX "WechatShippingIntent_status_next_retry_at_created_at_idx"
ON "WechatShippingIntent"("status", "next_retry_at", "created_at");

ALTER TABLE "WechatShippingIntent"
ADD CONSTRAINT "WechatShippingIntent_order_id_fkey"
FOREIGN KEY ("order_id") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
