ALTER TABLE "Product" ADD COLUMN "stock_unit" TEXT NOT NULL DEFAULT 'piece';
ALTER TABLE "Product" ADD COLUMN "sale_unit" TEXT NOT NULL DEFAULT '份';
ALTER TABLE "Product" ADD COLUMN "sale_spec_name" TEXT;
ALTER TABLE "Product" ADD COLUMN "stock_deduct_quantity" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "PurchasePlanItem" ADD COLUMN "purchase_unit" TEXT;
ALTER TABLE "PurchasePlanItem" ADD COLUMN "purchase_quantity" INTEGER;
ALTER TABLE "PurchasePlanItem" ADD COLUMN "stock_in_quantity" INTEGER;
