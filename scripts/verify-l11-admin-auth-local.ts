import { spawnSync } from 'node:child_process';
import { prisma } from '../apps/api/src/db.js';
import { buildApp } from '../apps/api/src/app.js';
import { decryptTotpSecret, generateTotpCode, hashPassword, verifyPassword } from '../apps/api/src/services/admin-auth-service.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type ApiResponse<T> = { success: boolean; data: T; message?: string };

function assertProductionTotpKeyValidation() {
  const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/validate-env.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:15432/community_selection?schema=public',
      PORT: process.env.PORT ?? '13080',
      ADMIN_AUTH_ENABLED: 'true',
      ADMIN_AUTH_MODE: 'session',
      ADMIN_TOKEN: 'strong-admin-token-for-l11-check',
      ADMIN_TOTP_ENCRYPTION_KEY: '',
      WECHAT_PAY_MODE: 'mock',
      MOCK_WECHAT_PAY: 'true',
      AUTO_PAYOUT_ENABLED: 'false',
      AUTO_TAX_FILING_ENABLED: 'false'
    }
  });
  assert(result.status !== 0, 'production/session env check should fail without ADMIN_TOTP_ENCRYPTION_KEY');
  assert(`${result.stdout}${result.stderr}`.includes('ADMIN_TOTP_ENCRYPTION_KEY'), 'env check should mention ADMIN_TOTP_ENCRYPTION_KEY');
}

process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

const app = buildApp();

async function main() {
  assertProductionTotpKeyValidation();
  const username = `admin_${Date.now()}`;
  const password = 'StrongPassword-123';
  const passwordHash = await hashPassword(password);
  assert(passwordHash !== password, 'password_hash must not store plain password');
  assert(await verifyPassword(password, passwordHash), 'password hash should verify');

  const adminUser = await prisma.adminUser.create({ data: { username, password_hash: passwordHash, role: 'admin' } });

  const wrongLogin = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password: 'wrong-password' } });
  assert(wrongLogin.statusCode === 401, `wrong password should fail, got ${wrongLogin.statusCode}`);
  const failedAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'admin_login_failed' }, orderBy: { created_at: 'desc' } });
  assert(failedAudit, 'failed login should write AdminAuditLog');

  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password } });
  assert(login.statusCode === 200, `login should succeed, got ${login.statusCode}`);
  const loginBody = login.json() as ApiResponse<{ token: string }>;
  assert(loginBody.success && loginBody.data.token, 'login should return session token');
  const successAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'admin_login_success', admin_user_id: adminUser.id }, orderBy: { created_at: 'desc' } });
  assert(successAudit, 'successful login should write AdminAuditLog');
  const cookie = login.headers['set-cookie'];
  assert(typeof cookie === 'string' && cookie.includes('HttpOnly'), 'login should set httpOnly cookie');
  const sessionRecord = await prisma.adminSession.findFirstOrThrow({ where: { admin_user_id: adminUser.id }, orderBy: { created_at: 'desc' } });
  assert(sessionRecord.session_token_hash !== loginBody.data.token, 'database should only store session token hash');
  assert(sessionRecord.session_token_hash.length >= 32, 'session token hash should be persisted');

  const setup = await app.inject({ method: 'POST', url: '/api/admin/auth/totp/setup', headers: { cookie } });
  assert(setup.statusCode === 200, `totp setup should succeed, got ${setup.statusCode}`);
  const latestAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminUser.id } });
  assert(latestAdmin.totp_secret_encrypted && !latestAdmin.totp_secret_encrypted.includes('otpauth'), 'TOTP secret should be encrypted');
  const secret = decryptTotpSecret(latestAdmin.totp_secret_encrypted!);
  const enable = await app.inject({ method: 'POST', url: '/api/admin/auth/totp/enable', headers: { cookie }, payload: { totp_code: generateTotpCode(secret) } });
  assert(enable.statusCode === 200, `totp enable should succeed, got ${enable.statusCode}`);
  const enableBody = enable.json() as ApiResponse<{ recovery_codes_once: string[] }>;
  const recoveryCode = enableBody.data.recovery_codes_once[0];
  assert(recoveryCode, 'enable should return recovery codes once');
  const setupAfterEnable = await app.inject({ method: 'POST', url: '/api/admin/auth/totp/setup', headers: { cookie } });
  assert(setupAfterEnable.statusCode === 400, `totp setup after enable should fail, got ${setupAfterEnable.statusCode}`);
  const setupAfterEnableBody = setupAfterEnable.json() as ApiResponse<null>;
  assert(setupAfterEnableBody.success === false && setupAfterEnableBody.message?.includes('二次验证已启用'), 'setup after enable should return clear message');

  const noTotpLogin = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password } });
  assert(noTotpLogin.statusCode === 401, `TOTP enabled login without code should fail, got ${noTotpLogin.statusCode}`);

  const totpLogin = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password, totp_code: generateTotpCode(secret) } });
  assert(totpLogin.statusCode === 200, `TOTP login should succeed, got ${totpLogin.statusCode}`);
  const totpCookie = totpLogin.headers['set-cookie'];
  assert(typeof totpCookie === 'string', 'TOTP login should set cookie');

  const recoveryLogin = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password, recovery_code: recoveryCode } });
  assert(recoveryLogin.statusCode === 200, `recovery code first use should succeed, got ${recoveryLogin.statusCode}`);
  const recoveryLoginAgain = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password, recovery_code: recoveryCode } });
  assert(recoveryLoginAgain.statusCode === 401, `recovery code reuse should fail, got ${recoveryLoginAgain.statusCode}`);

  const health = await app.inject({ method: 'GET', url: '/health' });
  assert(health.statusCode === 200, `/health should remain public, got ${health.statusCode}`);

  const alertsNoSession = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts' });
  assert(alertsNoSession.statusCode === 401, `admin logs without session should be 401, got ${alertsNoSession.statusCode}`);
  const alertsWithSession = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts', headers: { cookie: totpCookie } });
  assert(alertsWithSession.statusCode === 200, `admin logs with session should be 200, got ${alertsWithSession.statusCode}`);

  const alert = await prisma.opsAlertLog.create({ data: { alert_type: 'l11_auth_check', alert_level: 'warning', title: 'L11 auth check', message: 'verify alert audit' } });
  const resolve = await app.inject({ method: 'POST', url: `/api/admin/logs/alerts/${alert.id}/resolve`, headers: { cookie: totpCookie }, payload: { resolved_by: 'admin', resolution_note: 'verified' } });
  assert(resolve.statusCode === 200, `alert resolve should succeed, got ${resolve.statusCode}`);
  const alertAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'ops_alert_resolved', target_id: alert.id } });
  assert(alertAudit, 'alert resolve should write AdminAuditLog');
  const ignoredAlert = await prisma.opsAlertLog.create({ data: { alert_type: 'l11_auth_ignore_check', alert_level: 'warning', title: 'L11 ignore check', message: 'verify alert ignore audit' } });
  const ignore = await app.inject({ method: 'POST', url: `/api/admin/logs/alerts/${ignoredAlert.id}/ignore`, headers: { cookie: totpCookie }, payload: { resolved_by: 'admin', resolution_note: 'ignored in verification' } });
  assert(ignore.statusCode === 200, `alert ignore should succeed, got ${ignore.statusCode}`);
  const ignoreAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'ops_alert_ignored', target_id: ignoredAlert.id } });
  assert(ignoreAudit, 'alert ignore should write AdminAuditLog');

  const leader = await prisma.user.create({ data: { openid: `l11_leader_${Date.now()}`, nickname: 'L11开团人', role: 'leader' } });
  const customer = await prisma.user.create({ data: { openid: `l11_customer_${Date.now()}`, nickname: 'L11用户', role: 'customer' } });
  const product = await prisma.product.findFirstOrThrow();
  const community = await prisma.community.findFirstOrThrow();
  const groupBuy = await prisma.groupBuy.create({ data: { product_id: product.id, leader_user_id: leader.id, community_id: community.id, min_people: 1, min_quantity: 1, current_people: 1, current_quantity: 1, price_cents: product.price_cents, start_time: new Date(Date.now() - 3600_000), end_time: new Date(Date.now() + 3600_000), pickup_time: new Date(Date.now() + 86400_000), status: 'success' } });
  const order = await prisma.order.create({ data: { order_no: `L11-${Date.now()}`, user_id: customer.id, group_buy_id: groupBuy.id, product_id: product.id, leader_user_id: leader.id, community_id: community.id, total_amount_cents: 100, product_amount_cents: 100, pay_amount_cents: 100, quantity: 1, pay_status: 'paid', order_status: 'completed', refund_status: 'none', paid_at: new Date(), completed_at: new Date(), receiver_name: 'L11用户', receiver_phone: '13800000000' } });
  const withdrawal = await prisma.withdrawal.create({ data: { leader_user_id: leader.id, amount_cents: 100, taxable_amount_cents: 100, payable_amount_cents: 100 } });
  const commission = await prisma.commission.create({ data: { leader_user_id: leader.id, order_id: order.id, group_buy_id: groupBuy.id, base_amount_cents: 100, commission_type: 'fixed', commission_value: 100, estimated_amount_cents: 100, final_amount_cents: 100, status: 'withdrawing', withdrawal_id: withdrawal.id, available_at: new Date() } });
  await prisma.withdrawalCommission.create({ data: { withdrawal_id: withdrawal.id, commission_id: commission.id, amount_cents: 100 } });
  const taxReview = await app.inject({ method: 'POST', url: `/api/admin/withdrawals/${withdrawal.id}/tax-review`, headers: { cookie: totpCookie }, payload: { tax_mode: 'none', taxable_amount_cents: 100, tax_amount_cents: 0, tax_rate_basis: 'manual', idempotency_key: `l11-tax-review-${withdrawal.id}`, expected_version: withdrawal.version } });
  assert(taxReview.statusCode === 200, `withdrawal tax-review should succeed, got ${taxReview.statusCode}`);
  const taxAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'withdrawal_tax_reviewed', target_id: withdrawal.id } });
  assert(taxAudit, 'withdrawal tax-review should write AdminAuditLog');
  const afterTaxReview = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
  const approve = await app.inject({ method: 'POST', url: `/api/admin/withdrawals/${withdrawal.id}/approve`, headers: { cookie: totpCookie }, payload: { expected_version: afterTaxReview.version, idempotency_key: `l11-withdrawal-approve-${withdrawal.id}`, admin_remark: 'L11 verification' } });
  assert(approve.statusCode === 200, `withdrawal approve should succeed, got ${approve.statusCode}`);
  const withdrawalAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'withdrawal_approved', target_id: withdrawal.id } });
  assert(withdrawalAudit, 'withdrawal approve should write AdminAuditLog');
  const afterApprove = await prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } });
  const markPaid = await app.inject({ method: 'POST', url: `/api/admin/withdrawals/${withdrawal.id}/mark-paid`, headers: { cookie: totpCookie }, payload: { expected_version: afterApprove.version, idempotency_key: `l11-withdrawal-paid-${withdrawal.id}`, admin_remark: 'L11 verification paid', manual_reference: `L11-${withdrawal.id}` } });
  assert(markPaid.statusCode === 200, `withdrawal mark-paid should succeed, got ${markPaid.statusCode}`);
  const markPaidAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'withdrawal_mark_paid', target_id: withdrawal.id } });
  assert(markPaidAudit, 'withdrawal mark-paid should write AdminAuditLog');

  console.log('L11 admin auth verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
