CREATE TYPE "MembershipAccountStatus" AS ENUM ('active', 'expired', 'suspended');
CREATE TYPE "MembershipPeriodSource" AS ENUM ('legacy_free', 'annual_paid', 'manual');
CREATE TYPE "MembershipOrderStatus" AS ENUM ('pending_payment', 'paid', 'payment_exception', 'closed', 'refunded', 'chargeback');
CREATE TYPE "MemberGiftCampaignStatus" AS ENUM ('draft', 'active', 'ended', 'cancelled');
CREATE TYPE "MemberGiftClaimStatus" AS ENUM ('reserved', 'released', 'delivered', 'written_off');
CREATE TYPE "MemberGiftInventoryEventType" AS ENUM ('reserve', 'fulfillment_start', 'release', 'deliver', 'write_off');
CREATE TYPE "MemberGiftLossReason" AS ENUM ('damaged', 'lost', 'unsellable');

CREATE TABLE "MembershipAccount" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" "MembershipAccountStatus" NOT NULL DEFAULT 'active',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "suspension_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MembershipPeriod" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source" "MembershipPeriodSource" NOT NULL,
  "source_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MembershipPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MembershipOrder" (
  "id" TEXT NOT NULL, "order_no" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL DEFAULT 8800,
  "status" "MembershipOrderStatus" NOT NULL DEFAULT 'pending_payment',
  "idempotency_key" TEXT NOT NULL, "membership_period_id" TEXT, "paid_payment_id" TEXT,
  "paid_at" TIMESTAMP(3), "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MembershipPayment" (
  "id" TEXT NOT NULL, "membership_order_id" TEXT NOT NULL,
  "attempt_no" INTEGER NOT NULL DEFAULT 1, "out_trade_no" TEXT NOT NULL,
  "transaction_id" TEXT, "prepay_id" TEXT, "prepay_expires_at" TIMESTAMP(3),
  "provider_success_at" TIMESTAMP(3), "amount_cents" INTEGER NOT NULL DEFAULT 8800,
  "trade_state" TEXT NOT NULL DEFAULT 'created', "last_provider_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberGiftCampaign" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "gift_product_id" TEXT NOT NULL,
  "status" "MemberGiftCampaignStatus" NOT NULL DEFAULT 'draft',
  "starts_at" TIMESTAMP(3) NOT NULL, "ends_at" TIMESTAMP(3) NOT NULL,
  "max_claims_per_member" INTEGER NOT NULL DEFAULT 1,
  "inventory_total" INTEGER NOT NULL, "inventory_reserved" INTEGER NOT NULL DEFAULT 0,
  "inventory_delivered" INTEGER NOT NULL DEFAULT 0, "inventory_written_off" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberGiftCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberGiftClaim" (
  "id" TEXT NOT NULL, "campaign_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "membership_account_id" TEXT NOT NULL, "membership_period_id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1, "status" "MemberGiftClaimStatus" NOT NULL DEFAULT 'reserved',
  "claim_idempotency_key" TEXT NOT NULL, "released_at" TIMESTAMP(3), "delivered_at" TIMESTAMP(3),
  "written_off_at" TIMESTAMP(3), "loss_reason" "MemberGiftLossReason",
  "fulfillment_started_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberGiftClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberGiftInventoryEvent" (
  "id" TEXT NOT NULL, "campaign_id" TEXT NOT NULL, "claim_id" TEXT NOT NULL,
  "actor_user_id" TEXT, "actor_admin_user_id" TEXT, "event_type" "MemberGiftInventoryEventType" NOT NULL,
  "quantity" INTEGER NOT NULL, "idempotency_key" TEXT NOT NULL, "reason" "MemberGiftLossReason",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberGiftInventoryEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LegacyMemberEligibility" ADD COLUMN "membership_period_id" TEXT;
ALTER TABLE "Product"
  ADD COLUMN "member_pricing_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "member_discount_bps" INTEGER NOT NULL DEFAULT 9000,
  ADD COLUMN "group_member_discount_bps" INTEGER NOT NULL DEFAULT 8000,
  ADD COLUMN "minimum_member_margin_bps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minimum_member_margin_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "member_pricing_rule_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Order"
  ADD COLUMN "unit_price_cents" INTEGER,
  ADD COLUMN "price_source" TEXT,
  ADD COLUMN "pricing_snapshot" JSONB,
  ADD COLUMN "membership_period_id" TEXT;

CREATE UNIQUE INDEX "MembershipAccount_user_id_key" ON "MembershipAccount"("user_id");
CREATE INDEX "MembershipAccount_status_ends_at_idx" ON "MembershipAccount"("status", "ends_at");
CREATE UNIQUE INDEX "MembershipPeriod_idempotency_key_key" ON "MembershipPeriod"("idempotency_key");
CREATE UNIQUE INDEX "MembershipPeriod_source_source_id_key" ON "MembershipPeriod"("source", "source_id");
CREATE INDEX "MembershipPeriod_user_id_starts_at_ends_at_idx" ON "MembershipPeriod"("user_id", "starts_at", "ends_at");
CREATE INDEX "MembershipPeriod_account_id_created_at_idx" ON "MembershipPeriod"("account_id", "created_at");
CREATE UNIQUE INDEX "MembershipOrder_order_no_key" ON "MembershipOrder"("order_no");
CREATE UNIQUE INDEX "MembershipOrder_idempotency_key_key" ON "MembershipOrder"("idempotency_key");
CREATE UNIQUE INDEX "MembershipOrder_membership_period_id_key" ON "MembershipOrder"("membership_period_id");
CREATE UNIQUE INDEX "MembershipOrder_paid_payment_id_key" ON "MembershipOrder"("paid_payment_id");
CREATE INDEX "MembershipOrder_user_id_status_created_at_idx" ON "MembershipOrder"("user_id", "status", "created_at");
CREATE UNIQUE INDEX "MembershipPayment_out_trade_no_key" ON "MembershipPayment"("out_trade_no");
CREATE UNIQUE INDEX "MembershipPayment_transaction_id_key" ON "MembershipPayment"("transaction_id");
CREATE UNIQUE INDEX "MembershipPayment_membership_order_id_attempt_no_key" ON "MembershipPayment"("membership_order_id", "attempt_no");
CREATE INDEX "MembershipPayment_trade_state_created_at_idx" ON "MembershipPayment"("trade_state", "created_at");
CREATE UNIQUE INDEX "LegacyMemberEligibility_membership_period_id_key" ON "LegacyMemberEligibility"("membership_period_id");
CREATE INDEX "Order_membership_period_id_idx" ON "Order"("membership_period_id");
CREATE INDEX "MemberGiftCampaign_status_starts_at_ends_at_idx" ON "MemberGiftCampaign"("status", "starts_at", "ends_at");
CREATE INDEX "MemberGiftCampaign_gift_product_id_idx" ON "MemberGiftCampaign"("gift_product_id");
CREATE UNIQUE INDEX "MemberGiftClaim_claim_idempotency_key_key" ON "MemberGiftClaim"("claim_idempotency_key");
CREATE UNIQUE INDEX "MemberGiftClaim_order_id_key" ON "MemberGiftClaim"("order_id");
CREATE INDEX "MemberGiftClaim_campaign_id_membership_account_id_status_idx" ON "MemberGiftClaim"("campaign_id", "membership_account_id", "status");
CREATE INDEX "MemberGiftClaim_user_id_created_at_idx" ON "MemberGiftClaim"("user_id", "created_at");
CREATE UNIQUE INDEX "MemberGiftInventoryEvent_idempotency_key_key" ON "MemberGiftInventoryEvent"("idempotency_key");
CREATE INDEX "MemberGiftInventoryEvent_campaign_id_created_at_idx" ON "MemberGiftInventoryEvent"("campaign_id", "created_at");
CREATE INDEX "MemberGiftInventoryEvent_claim_id_created_at_idx" ON "MemberGiftInventoryEvent"("claim_id", "created_at");

ALTER TABLE "MembershipAccount" ADD CONSTRAINT "MembershipAccount_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipPeriod" ADD CONSTRAINT "MembershipPeriod_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "MembershipAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipPeriod" ADD CONSTRAINT "MembershipPeriod_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_membership_period_id_fkey"
  FOREIGN KEY ("membership_period_id") REFERENCES "MembershipPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_membership_order_id_fkey"
  FOREIGN KEY ("membership_order_id") REFERENCES "MembershipOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_paid_payment_id_fkey"
  FOREIGN KEY ("paid_payment_id") REFERENCES "MembershipPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacyMemberEligibility" ADD CONSTRAINT "LegacyMemberEligibility_membership_period_id_fkey"
  FOREIGN KEY ("membership_period_id") REFERENCES "MembershipPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_membership_period_id_fkey"
  FOREIGN KEY ("membership_period_id") REFERENCES "MembershipPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MemberGiftCampaign" ADD CONSTRAINT "MemberGiftCampaign_gift_product_id_fkey" FOREIGN KEY ("gift_product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftClaim" ADD CONSTRAINT "MemberGiftClaim_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "MemberGiftCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftClaim" ADD CONSTRAINT "MemberGiftClaim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftClaim" ADD CONSTRAINT "MemberGiftClaim_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftClaim" ADD CONSTRAINT "MemberGiftClaim_membership_account_id_fkey" FOREIGN KEY ("membership_account_id") REFERENCES "MembershipAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftClaim" ADD CONSTRAINT "MemberGiftClaim_membership_period_id_fkey" FOREIGN KEY ("membership_period_id") REFERENCES "MembershipPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftInventoryEvent" ADD CONSTRAINT "MemberGiftInventoryEvent_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "MemberGiftCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftInventoryEvent" ADD CONSTRAINT "MemberGiftInventoryEvent_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "MemberGiftClaim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftInventoryEvent" ADD CONSTRAINT "MemberGiftInventoryEvent_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemberGiftInventoryEvent" ADD CONSTRAINT "MemberGiftInventoryEvent_actor_admin_user_id_fkey" FOREIGN KEY ("actor_admin_user_id") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MembershipAccount" ADD CONSTRAINT "MembershipAccount_period_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "MembershipPeriod" ADD CONSTRAINT "MembershipPeriod_period_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_amount_check" CHECK ("amount_cents" = 8800);
ALTER TABLE "MembershipOrder" ADD CONSTRAINT "MembershipOrder_paid_evidence_check" CHECK (
  ("status" = 'paid' AND "paid_at" IS NOT NULL AND "membership_period_id" IS NOT NULL AND "paid_payment_id" IS NOT NULL) OR
  ("status" = 'payment_exception' AND "paid_at" IS NOT NULL AND "membership_period_id" IS NULL AND "paid_payment_id" IS NOT NULL) OR
  "status" NOT IN ('paid', 'payment_exception')
);
ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_amount_check" CHECK ("amount_cents" = 8800);
ALTER TABLE "MembershipPayment" ADD CONSTRAINT "MembershipPayment_attempt_check" CHECK ("attempt_no" >= 1);
ALTER TABLE "Product" ADD CONSTRAINT "Product_member_discount_bps_check" CHECK ("member_discount_bps" BETWEEN 1 AND 10000);
ALTER TABLE "Product" ADD CONSTRAINT "Product_group_member_discount_bps_check" CHECK ("group_member_discount_bps" BETWEEN 1 AND 10000);
ALTER TABLE "Product" ADD CONSTRAINT "Product_minimum_member_margin_bps_check" CHECK ("minimum_member_margin_bps" BETWEEN 0 AND 9999);
ALTER TABLE "Product" ADD CONSTRAINT "Product_minimum_member_margin_cents_check" CHECK ("minimum_member_margin_cents" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_member_pricing_rule_version_check" CHECK ("member_pricing_rule_version" >= 1);
ALTER TABLE "MemberGiftCampaign" ADD CONSTRAINT "MemberGiftCampaign_period_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "MemberGiftCampaign" ADD CONSTRAINT "MemberGiftCampaign_claim_limit_check" CHECK ("max_claims_per_member" >= 1);
ALTER TABLE "MemberGiftCampaign" ADD CONSTRAINT "MemberGiftCampaign_inventory_check" CHECK (
  "inventory_total" >= 0 AND "inventory_reserved" >= 0 AND "inventory_delivered" >= 0 AND
  "inventory_written_off" >= 0 AND
  "inventory_reserved" + "inventory_delivered" + "inventory_written_off" <= "inventory_total"
);
ALTER TABLE "MemberGiftClaim" ADD CONSTRAINT "MemberGiftClaim_quantity_check" CHECK ("quantity" = 1);
ALTER TABLE "MemberGiftInventoryEvent" ADD CONSTRAINT "MemberGiftInventoryEvent_quantity_check" CHECK ("quantity" = 1);
ALTER TABLE "MemberGiftInventoryEvent" ADD CONSTRAINT "MemberGiftInventoryEvent_actor_check" CHECK (
  ("actor_user_id" IS NOT NULL AND "actor_admin_user_id" IS NULL) OR
  ("actor_user_id" IS NULL AND "actor_admin_user_id" IS NOT NULL)
);
