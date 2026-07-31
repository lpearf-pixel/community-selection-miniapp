CREATE TYPE "DeliveryFulfillmentStatus" AS ENUM (
  'pending_dispatch',
  'delivering',
  'delivered',
  'exception'
);

ALTER TABLE "Order"
ADD COLUMN "delivery_status" "DeliveryFulfillmentStatus",
ADD COLUMN "delivery_status_updated_at" TIMESTAMP(3),
ADD COLUMN "fulfillment_promise_snapshot" JSONB,
ADD COLUMN "promised_fulfillment_start_at" TIMESTAMP(3),
ADD COLUMN "promised_fulfillment_end_at" TIMESTAMP(3);

UPDATE "Order"
SET
  "delivery_status" = CASE
    WHEN "order_status" IN ('delivered', 'completed')
      THEN 'delivered'::"DeliveryFulfillmentStatus"
    WHEN "order_status" IN ('paid', 'grouped', 'preparing', 'ready', 'picked')
      THEN 'pending_dispatch'::"DeliveryFulfillmentStatus"
    ELSE NULL
  END,
  "delivery_status_updated_at" = "updated_at"
WHERE "pickup_type" = 'delivery';

CREATE INDEX "Order_delivery_status_idx"
ON "Order"("delivery_status");

CREATE INDEX "Order_promised_fulfillment_start_at_idx"
ON "Order"("promised_fulfillment_start_at");
