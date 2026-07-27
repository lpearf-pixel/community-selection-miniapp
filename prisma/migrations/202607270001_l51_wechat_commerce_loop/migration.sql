-- L51 real WeChat commerce loop persistence.
-- Raw provider payload columns are intentionally removed; only verified,
-- minimized receipt metadata and SHA-256 body digests are retained.

CREATE TABLE "UserSession" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSession_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserSession_token_hash_key"
  ON "UserSession"("token_hash");
CREATE INDEX "UserSession_user_id_idx" ON "UserSession"("user_id");
CREATE INDEX "UserSession_expires_at_idx" ON "UserSession"("expires_at");
CREATE INDEX "UserSession_revoked_at_idx" ON "UserSession"("revoked_at");

CREATE TABLE "WechatNotificationReceipt" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "notification_type" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "resource_identifier" TEXT,
  "body_sha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "failure_code" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WechatNotificationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WechatNotificationReceipt_notification_id_key"
  ON "WechatNotificationReceipt"("notification_id");
CREATE INDEX "WechatNotificationReceipt_status_created_at_idx"
  ON "WechatNotificationReceipt"("status", "created_at");
CREATE INDEX "WechatNotificationReceipt_notification_type_resource_identifier_idx"
  ON "WechatNotificationReceipt"("notification_type", "resource_identifier");

ALTER TABLE "Payment"
  ADD COLUMN "attempt_no" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "prepay_expires_at" TIMESTAMP(3),
  ADD COLUMN "provider_success_at" TIMESTAMP(3),
  ADD COLUMN "last_reconciled_at" TIMESTAMP(3),
  ADD COLUMN "reconcile_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_provider_error_code" TEXT;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "order_id"
      ORDER BY "created_at", "id"
    ) AS "attempt_no"
  FROM "Payment"
)
UPDATE "Payment" AS payment
SET "attempt_no" = ranked."attempt_no"
FROM ranked
WHERE payment."id" = ranked."id";

CREATE UNIQUE INDEX "Payment_order_id_attempt_no_key"
  ON "Payment"("order_id", "attempt_no");
CREATE INDEX "Payment_trade_state_last_reconciled_at_idx"
  ON "Payment"("trade_state", "last_reconciled_at");

ALTER TABLE "Refund"
  ADD COLUMN "provider_status" TEXT,
  ADD COLUMN "last_reconciled_at" TIMESTAMP(3),
  ADD COLUMN "reconcile_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_provider_error_code" TEXT;

ALTER TABLE "OpsAlertLog" ADD COLUMN "dedupe_key" TEXT;
CREATE UNIQUE INDEX "OpsAlertLog_dedupe_key_key"
  ON "OpsAlertLog"("dedupe_key");

ALTER TABLE "Payment" DROP COLUMN "raw_notify";
ALTER TABLE "Refund" DROP COLUMN "raw_notify";
