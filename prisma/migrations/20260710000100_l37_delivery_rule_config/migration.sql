CREATE TABLE "DeliveryRuleConfig" (
    "id" TEXT NOT NULL,
    "pickup_store_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "base_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "free_threshold_cents" INTEGER,
    "max_distance_km" DOUBLE PRECISION,
    "service_radius_text" TEXT NOT NULL,
    "notice" TEXT NOT NULL,
    "time_windows_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRuleConfig_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliveryRuleConfig_pickup_store_id_idx" ON "DeliveryRuleConfig"("pickup_store_id");

ALTER TABLE "DeliveryRuleConfig" ADD CONSTRAINT "DeliveryRuleConfig_pickup_store_id_fkey" FOREIGN KEY ("pickup_store_id") REFERENCES "PickupStore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
