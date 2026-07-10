ALTER TABLE "Order" ADD COLUMN "product_refund_amount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "delivery_refund_amount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD COLUMN "product_refund_amount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD COLUMN "delivery_refund_amount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AfterSaleCase" ADD COLUMN "requested_product_refund_cents" INTEGER;
ALTER TABLE "AfterSaleCase" ADD COLUMN "requested_delivery_refund_cents" INTEGER;
ALTER TABLE "AfterSaleCase" ADD COLUMN "approved_product_refund_cents" INTEGER;
ALTER TABLE "AfterSaleCase" ADD COLUMN "approved_delivery_refund_cents" INTEGER;
