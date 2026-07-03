-- L15 after-sale customer support cases and logs
CREATE TABLE "AfterSaleCase" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "user_id" TEXT,
  "group_buy_id" TEXT,
  "product_id" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "resolution_type" TEXT,
  "reason" TEXT NOT NULL,
  "description" TEXT,
  "requested_refund_cents" INTEGER,
  "approved_refund_cents" INTEGER,
  "evidence_image_urls" JSONB,
  "responsibility" TEXT,
  "customer_note" TEXT,
  "admin_note" TEXT,
  "refund_id" TEXT,
  "inventory_loss_id" TEXT,
  "reviewed_by_admin_id" TEXT,
  "resolved_by_admin_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AfterSaleCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AfterSaleLog" (
  "id" TEXT NOT NULL,
  "after_sale_case_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_type" TEXT NOT NULL,
  "actor_id" TEXT,
  "note" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AfterSaleLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AfterSaleCase_order_id_idx" ON "AfterSaleCase"("order_id");
CREATE INDEX "AfterSaleCase_user_id_idx" ON "AfterSaleCase"("user_id");
CREATE INDEX "AfterSaleCase_group_buy_id_idx" ON "AfterSaleCase"("group_buy_id");
CREATE INDEX "AfterSaleCase_product_id_idx" ON "AfterSaleCase"("product_id");
CREATE INDEX "AfterSaleCase_status_idx" ON "AfterSaleCase"("status");
CREATE INDEX "AfterSaleCase_type_idx" ON "AfterSaleCase"("type");
CREATE INDEX "AfterSaleCase_created_at_idx" ON "AfterSaleCase"("created_at");
CREATE INDEX "AfterSaleLog_after_sale_case_id_idx" ON "AfterSaleLog"("after_sale_case_id");
CREATE INDEX "AfterSaleLog_action_idx" ON "AfterSaleLog"("action");
CREATE INDEX "AfterSaleLog_created_at_idx" ON "AfterSaleLog"("created_at");

ALTER TABLE "AfterSaleCase" ADD CONSTRAINT "AfterSaleCase_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AfterSaleCase" ADD CONSTRAINT "AfterSaleCase_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AfterSaleCase" ADD CONSTRAINT "AfterSaleCase_group_buy_id_fkey" FOREIGN KEY ("group_buy_id") REFERENCES "GroupBuy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AfterSaleCase" ADD CONSTRAINT "AfterSaleCase_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AfterSaleCase" ADD CONSTRAINT "AfterSaleCase_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AfterSaleCase" ADD CONSTRAINT "AfterSaleCase_resolved_by_admin_id_fkey" FOREIGN KEY ("resolved_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AfterSaleLog" ADD CONSTRAINT "AfterSaleLog_after_sale_case_id_fkey" FOREIGN KEY ("after_sale_case_id") REFERENCES "AfterSaleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
