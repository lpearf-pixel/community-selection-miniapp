CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "direction" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stock_before" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "operator_type" TEXT,
    "operator_id" TEXT,
    "remark" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchasePlan" (
    "id" TEXT NOT NULL,
    "plan_no" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "target_date" TIMESTAMP(3) NOT NULL,
    "supplier_name" TEXT,
    "total_quantity" INTEGER NOT NULL DEFAULT 0,
    "total_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "created_by_admin_id" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PurchasePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchasePlanItem" (
    "id" TEXT NOT NULL,
    "purchase_plan_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "planned_quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "cost_price_cents" INTEGER NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchasePlanItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchasePlan_plan_no_key" ON "PurchasePlan"("plan_no");
CREATE INDEX "StockLedger_product_id_idx" ON "StockLedger"("product_id");
CREATE INDEX "StockLedger_source_type_source_id_idx" ON "StockLedger"("source_type", "source_id");
CREATE INDEX "StockLedger_created_at_idx" ON "StockLedger"("created_at");
CREATE INDEX "PurchasePlan_status_idx" ON "PurchasePlan"("status");
CREATE INDEX "PurchasePlan_target_date_idx" ON "PurchasePlan"("target_date");
CREATE INDEX "PurchasePlan_created_by_admin_id_idx" ON "PurchasePlan"("created_by_admin_id");
CREATE INDEX "PurchasePlanItem_purchase_plan_id_idx" ON "PurchasePlanItem"("purchase_plan_id");
CREATE INDEX "PurchasePlanItem_product_id_idx" ON "PurchasePlanItem"("product_id");

ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePlan" ADD CONSTRAINT "PurchasePlan_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchasePlanItem" ADD CONSTRAINT "PurchasePlanItem_purchase_plan_id_fkey" FOREIGN KEY ("purchase_plan_id") REFERENCES "PurchasePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePlanItem" ADD CONSTRAINT "PurchasePlanItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
