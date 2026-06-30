CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "status" TEXT NOT NULL DEFAULT 'active',
  "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
  "totp_secret_encrypted" TEXT,
  "passkey_enabled" BOOLEAN NOT NULL DEFAULT false,
  "mtls_subject" TEXT,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

CREATE TABLE "AdminSession" (
  "id" TEXT NOT NULL,
  "admin_user_id" TEXT NOT NULL,
  "session_token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminSession_session_token_hash_key" ON "AdminSession"("session_token_hash");
CREATE INDEX "AdminSession_admin_user_id_idx" ON "AdminSession"("admin_user_id");
CREATE INDEX "AdminSession_expires_at_idx" ON "AdminSession"("expires_at");
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AdminRecoveryCode" (
  "id" TEXT NOT NULL,
  "admin_user_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminRecoveryCode_admin_user_id_idx" ON "AdminRecoveryCode"("admin_user_id");
ALTER TABLE "AdminRecoveryCode" ADD CONSTRAINT "AdminRecoveryCode_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "admin_user_id" TEXT,
  "action" TEXT NOT NULL,
  "target_type" TEXT,
  "target_id" TEXT,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAuditLog_admin_user_id_idx" ON "AdminAuditLog"("admin_user_id");
CREATE INDEX "AdminAuditLog_action_idx" ON "AdminAuditLog"("action");
CREATE INDEX "AdminAuditLog_created_at_idx" ON "AdminAuditLog"("created_at");
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
