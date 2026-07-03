CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contact_name" TEXT,
  "contact_phone" TEXT,
  "address" TEXT,
  "license_no" TEXT,
  "certification_info" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductBatch" (
  "id" TEXT NOT NULL,
  "batch_no" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "supplier_id" TEXT,
  "purchase_plan_id" TEXT,
  "purchase_plan_item_id" TEXT,
  "product_name_snapshot" TEXT NOT NULL,
  "supplier_name_snapshot" TEXT,
  "stock_unit" TEXT NOT NULL,
  "initial_quantity" INTEGER NOT NULL,
  "remaining_quantity" INTEGER NOT NULL,
  "cost_price_cents" INTEGER,
  "production_date" TIMESTAMP(3),
  "arrival_date" TIMESTAMP(3) NOT NULL,
  "shelf_life_days" INTEGER,
  "expire_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'active',
  "remark" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BatchStockLedger" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT,
  "direction" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "batch_quantity_before" INTEGER NOT NULL,
  "batch_quantity_after" INTEGER NOT NULL,
  "product_stock_before" INTEGER,
  "product_stock_after" INTEGER,
  "operator_type" TEXT,
  "operator_id" TEXT,
  "remark" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BatchStockLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryLoss" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "loss_type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "stock_unit" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "responsible_type" TEXT,
  "supplier_id" TEXT,
  "operator_admin_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryLoss_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockCheck" (
  "id" TEXT NOT NULL,
  "check_no" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "operator_admin_id" TEXT,
  "remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMP(3),
  CONSTRAINT "StockCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockCheckItem" (
  "id" TEXT NOT NULL,
  "stock_check_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "batch_id" TEXT,
  "book_quantity" INTEGER NOT NULL,
  "actual_quantity" INTEGER NOT NULL,
  "diff_quantity" INTEGER NOT NULL,
  "stock_unit" TEXT NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockCheckItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");
CREATE INDEX "Supplier_created_at_idx" ON "Supplier"("created_at");
CREATE UNIQUE INDEX "ProductBatch_batch_no_key" ON "ProductBatch"("batch_no");
CREATE INDEX "ProductBatch_product_id_idx" ON "ProductBatch"("product_id");
CREATE INDEX "ProductBatch_supplier_id_idx" ON "ProductBatch"("supplier_id");
CREATE INDEX "ProductBatch_purchase_plan_id_idx" ON "ProductBatch"("purchase_plan_id");
CREATE INDEX "ProductBatch_expire_at_idx" ON "ProductBatch"("expire_at");
CREATE INDEX "ProductBatch_status_idx" ON "ProductBatch"("status");
CREATE INDEX "ProductBatch_created_at_idx" ON "ProductBatch"("created_at");
CREATE INDEX "BatchStockLedger_batch_id_idx" ON "BatchStockLedger"("batch_id");
CREATE INDEX "BatchStockLedger_product_id_idx" ON "BatchStockLedger"("product_id");
CREATE INDEX "BatchStockLedger_source_type_source_id_idx" ON "BatchStockLedger"("source_type", "source_id");
CREATE INDEX "BatchStockLedger_created_at_idx" ON "BatchStockLedger"("created_at");
CREATE INDEX "InventoryLoss_product_id_idx" ON "InventoryLoss"("product_id");
CREATE INDEX "InventoryLoss_batch_id_idx" ON "InventoryLoss"("batch_id");
CREATE INDEX "InventoryLoss_supplier_id_idx" ON "InventoryLoss"("supplier_id");
CREATE INDEX "InventoryLoss_loss_type_idx" ON "InventoryLoss"("loss_type");
CREATE INDEX "InventoryLoss_created_at_idx" ON "InventoryLoss"("created_at");
CREATE UNIQUE INDEX "StockCheck_check_no_key" ON "StockCheck"("check_no");
CREATE INDEX "StockCheck_status_idx" ON "StockCheck"("status");
CREATE INDEX "StockCheck_created_at_idx" ON "StockCheck"("created_at");
CREATE INDEX "StockCheckItem_stock_check_id_idx" ON "StockCheckItem"("stock_check_id");
CREATE INDEX "StockCheckItem_product_id_idx" ON "StockCheckItem"("product_id");
CREATE INDEX "StockCheckItem_batch_id_idx" ON "StockCheckItem"("batch_id");

ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_purchase_plan_id_fkey" FOREIGN KEY ("purchase_plan_id") REFERENCES "PurchasePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductBatch" ADD CONSTRAINT "ProductBatch_purchase_plan_item_id_fkey" FOREIGN KEY ("purchase_plan_item_id") REFERENCES "PurchasePlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BatchStockLedger" ADD CONSTRAINT "BatchStockLedger_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ProductBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BatchStockLedger" ADD CONSTRAINT "BatchStockLedger_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLoss" ADD CONSTRAINT "InventoryLoss_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryLoss" ADD CONSTRAINT "InventoryLoss_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryLoss" ADD CONSTRAINT "InventoryLoss_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryLoss" ADD CONSTRAINT "InventoryLoss_operator_admin_id_fkey" FOREIGN KEY ("operator_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockCheck" ADD CONSTRAINT "StockCheck_operator_admin_id_fkey" FOREIGN KEY ("operator_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockCheckItem" ADD CONSTRAINT "StockCheckItem_stock_check_id_fkey" FOREIGN KEY ("stock_check_id") REFERENCES "StockCheck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCheckItem" ADD CONSTRAINT "StockCheckItem_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockCheckItem" ADD CONSTRAINT "StockCheckItem_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "ProductBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
