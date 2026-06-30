CREATE TYPE "BusinessEventLevel" AS ENUM ('info', 'warning', 'error', 'critical');
CREATE TYPE "OrderTimelineActorType" AS ENUM ('system', 'user', 'admin', 'wechat', 'scheduler');
CREATE TYPE "OpsAlertLevel" AS ENUM ('warning', 'error', 'critical');
CREATE TYPE "OpsAlertStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'ignored');

CREATE TABLE "BusinessEventLog" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_level" "BusinessEventLevel" NOT NULL DEFAULT 'info',
  "event_source" TEXT NOT NULL,
  "order_id" TEXT,
  "group_buy_id" TEXT,
  "payment_id" TEXT,
  "refund_id" TEXT,
  "commission_id" TEXT,
  "withdrawal_id" TEXT,
  "leader_user_id" TEXT,
  "user_id" TEXT,
  "trace_id" TEXT,
  "request_id" TEXT,
  "idempotency_key" TEXT,
  "before_snapshot" JSONB,
  "after_snapshot" JSONB,
  "payload" JSONB,
  "message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessEventLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderTimelineLog" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "from_status" TEXT,
  "to_status" TEXT,
  "actor_type" "OrderTimelineActorType" NOT NULL DEFAULT 'system',
  "actor_user_id" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTimelineLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpsAlertLog" (
  "id" TEXT NOT NULL,
  "alert_type" TEXT NOT NULL,
  "alert_level" "OpsAlertLevel" NOT NULL DEFAULT 'warning',
  "status" "OpsAlertStatus" NOT NULL DEFAULT 'open',
  "order_id" TEXT,
  "group_buy_id" TEXT,
  "payment_id" TEXT,
  "refund_id" TEXT,
  "commission_id" TEXT,
  "withdrawal_id" TEXT,
  "leader_user_id" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpsAlertLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BusinessEventLog_order_id_idx" ON "BusinessEventLog"("order_id");
CREATE INDEX "BusinessEventLog_event_type_idx" ON "BusinessEventLog"("event_type");
CREATE INDEX "BusinessEventLog_event_level_idx" ON "BusinessEventLog"("event_level");
CREATE INDEX "BusinessEventLog_leader_user_id_idx" ON "BusinessEventLog"("leader_user_id");
CREATE INDEX "BusinessEventLog_created_at_idx" ON "BusinessEventLog"("created_at");
CREATE INDEX "OrderTimelineLog_order_id_idx" ON "OrderTimelineLog"("order_id");
CREATE INDEX "OrderTimelineLog_event_type_idx" ON "OrderTimelineLog"("event_type");
CREATE INDEX "OrderTimelineLog_created_at_idx" ON "OrderTimelineLog"("created_at");
CREATE INDEX "OpsAlertLog_status_idx" ON "OpsAlertLog"("status");
CREATE INDEX "OpsAlertLog_alert_level_idx" ON "OpsAlertLog"("alert_level");
CREATE INDEX "OpsAlertLog_order_id_idx" ON "OpsAlertLog"("order_id");
CREATE INDEX "OpsAlertLog_created_at_idx" ON "OpsAlertLog"("created_at");
