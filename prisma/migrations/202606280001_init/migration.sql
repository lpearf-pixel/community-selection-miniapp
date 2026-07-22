CREATE TYPE "UserRole" AS ENUM ('customer', 'leader', 'admin');
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'active', 'inactive');
CREATE TYPE "GroupBuyStatus" AS ENUM ('pending', 'success', 'failed', 'cancelled', 'preparing', 'ready', 'fulfilled', 'closed');
CREATE TYPE "OrderStatus" AS ENUM ('unpaid', 'paid', 'grouped', 'preparing', 'ready', 'picked', 'delivered', 'completed', 'refunding', 'refunded', 'closed');
CREATE TYPE "PayStatus" AS ENUM ('unpaid', 'paid', 'failed', 'closed');
CREATE TYPE "RefundStatus" AS ENUM ('none', 'pending', 'approved', 'processing', 'success', 'failed', 'rejected');
CREATE TYPE "CommissionStatus" AS ENUM ('estimated', 'frozen', 'pending', 'available', 'withdrawn', 'deducted', 'cancelled');
CREATE TYPE "CommissionType" AS ENUM ('none', 'fixed', 'percent');
CREATE TYPE "PickupType" AS ENUM ('store', 'delivery');
CREATE TYPE "WithdrawalStatus" AS ENUM ('pending', 'approved', 'paid', 'rejected');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "openid" TEXT NOT NULL,
  "unionid" TEXT,
  "nickname" TEXT NOT NULL,
  "avatar_url" TEXT,
  "phone" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'customer',
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "cover_image" TEXT,
  "images" JSONB NOT NULL DEFAULT '[]',
  "description" TEXT,
  "price_cents" INTEGER NOT NULL,
  "cost_price_cents" INTEGER NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "unit" TEXT NOT NULL,
  "is_group_enabled" BOOLEAN NOT NULL DEFAULT false,
  "commission_type" "CommissionType" NOT NULL DEFAULT 'none',
  "commission_value" INTEGER NOT NULL DEFAULT 0,
  "status" "ProductStatus" NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Community" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupStore" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "latitude" DECIMAL(10,6),
  "longitude" DECIMAL(10,6),
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PickupStore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GroupBuy" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "leader_user_id" TEXT NOT NULL,
  "community_id" TEXT NOT NULL,
  "min_people" INTEGER NOT NULL,
  "min_quantity" INTEGER NOT NULL,
  "current_people" INTEGER NOT NULL DEFAULT 0,
  "current_quantity" INTEGER NOT NULL DEFAULT 0,
  "price_cents" INTEGER NOT NULL,
  "start_time" TIMESTAMP(3) NOT NULL,
  "end_time" TIMESTAMP(3) NOT NULL,
  "pickup_time" TIMESTAMP(3) NOT NULL,
  "status" "GroupBuyStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GroupBuy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "order_no" TEXT NOT NULL,
  "client_request_id" TEXT,
  "user_id" TEXT NOT NULL,
  "group_buy_id" TEXT,
  "leader_user_id" TEXT,
  "total_amount_cents" INTEGER NOT NULL,
  "pay_amount_cents" INTEGER NOT NULL,
  "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "pay_status" "PayStatus" NOT NULL DEFAULT 'unpaid',
  "order_status" "OrderStatus" NOT NULL DEFAULT 'unpaid',
  "refund_status" "RefundStatus" NOT NULL DEFAULT 'none',
  "pickup_type" "PickupType" NOT NULL DEFAULT 'store',
  "pickup_store_id" TEXT,
  "community_id" TEXT,
  "receiver_name" TEXT NOT NULL,
  "receiver_phone" TEXT NOT NULL,
  "receiver_address" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "out_trade_no" TEXT NOT NULL,
  "transaction_id" TEXT,
  "prepay_id" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "trade_state" TEXT NOT NULL,
  "raw_notify" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "out_refund_no" TEXT NOT NULL,
  "refund_id" TEXT,
  "refund_amount_cents" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'pending',
  "raw_notify" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Commission" (
  "id" TEXT NOT NULL,
  "leader_user_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "group_buy_id" TEXT NOT NULL,
  "base_amount_cents" INTEGER NOT NULL,
  "commission_type" "CommissionType" NOT NULL,
  "commission_value" INTEGER NOT NULL,
  "estimated_amount_cents" INTEGER NOT NULL,
  "deduct_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "final_amount_cents" INTEGER NOT NULL,
  "status" "CommissionStatus" NOT NULL DEFAULT 'estimated',
  "available_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaderApplication" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "real_name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "community_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "admin_remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaderApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Withdrawal" (
  "id" TEXT NOT NULL,
  "leader_user_id" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "status" "WithdrawalStatus" NOT NULL DEFAULT 'pending',
  "admin_remark" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_openid_key" ON "User"("openid");
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE UNIQUE INDEX "Community_name_key" ON "Community"("name");
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");
CREATE INDEX "GroupBuy_product_id_idx" ON "GroupBuy"("product_id");
CREATE INDEX "GroupBuy_leader_user_id_idx" ON "GroupBuy"("leader_user_id");
CREATE UNIQUE INDEX "Order_order_no_key" ON "Order"("order_no");
CREATE UNIQUE INDEX "Order_client_request_id_key" ON "Order"("client_request_id");
CREATE INDEX "Order_user_id_idx" ON "Order"("user_id");
CREATE INDEX "Order_group_buy_id_idx" ON "Order"("group_buy_id");
CREATE UNIQUE INDEX "Payment_out_trade_no_key" ON "Payment"("out_trade_no");
CREATE UNIQUE INDEX "Payment_transaction_id_key" ON "Payment"("transaction_id");
CREATE UNIQUE INDEX "Refund_out_refund_no_key" ON "Refund"("out_refund_no");
CREATE UNIQUE INDEX "Refund_refund_id_key" ON "Refund"("refund_id");
CREATE INDEX "Commission_leader_user_id_idx" ON "Commission"("leader_user_id");

ALTER TABLE "Product" ADD CONSTRAINT "Product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_leader_user_id_fkey" FOREIGN KEY ("leader_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupBuy" ADD CONSTRAINT "GroupBuy_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_group_buy_id_fkey" FOREIGN KEY ("group_buy_id") REFERENCES "GroupBuy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_leader_user_id_fkey" FOREIGN KEY ("leader_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickup_store_id_fkey" FOREIGN KEY ("pickup_store_id") REFERENCES "PickupStore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_leader_user_id_fkey" FOREIGN KEY ("leader_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_group_buy_id_fkey" FOREIGN KEY ("group_buy_id") REFERENCES "GroupBuy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaderApplication" ADD CONSTRAINT "LeaderApplication_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeaderApplication" ADD CONSTRAINT "LeaderApplication_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_leader_user_id_fkey" FOREIGN KEY ("leader_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
