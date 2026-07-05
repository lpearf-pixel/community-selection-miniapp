-- L17.5 normal purchase orders reuse Order with an optional direct product reference.
ALTER TABLE "Order" ADD COLUMN "product_id" TEXT;

ALTER TABLE "Order" ADD CONSTRAINT "Order_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_product_id_idx" ON "Order"("product_id");
