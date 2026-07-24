ALTER TABLE "Order"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AdminCommandReceipt" (
  "id" TEXT NOT NULL,
  "admin_user_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_http_status" INTEGER,
  "response_code" TEXT,
  "response_data" JSONB,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminCommandReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminCommandReceipt_admin_user_id_idempotency_key_key"
ON "AdminCommandReceipt"("admin_user_id", "idempotency_key");

CREATE INDEX "AdminCommandReceipt_operation_target_id_idx"
ON "AdminCommandReceipt"("operation", "target_id");

CREATE INDEX "AdminCommandReceipt_created_at_idx"
ON "AdminCommandReceipt"("created_at");
