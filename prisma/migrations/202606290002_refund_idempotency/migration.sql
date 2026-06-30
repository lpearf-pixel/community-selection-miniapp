ALTER TABLE "Refund" ADD COLUMN "client_refund_id" TEXT;
ALTER TABLE "Refund" ADD COLUMN "stock_restored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Refund" ADD COLUMN "processed_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "Refund_client_refund_id_key" ON "Refund"("client_refund_id");
