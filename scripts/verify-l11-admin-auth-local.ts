import { prisma } from '../apps/api/src/db.js';
import { buildApp } from '../apps/api/src/app.js';
import { decryptTotpSecret, generateTotpCode, hashPassword, verifyPassword } from '../apps/api/src/services/admin-auth-service.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type ApiResponse<T> = { success: boolean; data: T; message?: string };

process.env.ADMIN_AUTH_MODE = 'session';
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.ADMIN_TOTP_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

const app = buildApp();

async function main() {
  const username = `admin_${Date.now()}`;
  const password = 'StrongPassword-123';
  const passwordHash = await hashPassword(password);
  assert(passwordHash !== password, 'password_hash must not store plain password');
  assert(await verifyPassword(password, passwordHash), 'password hash should verify');

  const adminUser = await prisma.adminUser.create({ data: { username, password_hash: passwordHash, role: 'admin' } });

  const wrongLogin = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password: 'wrong-password' } });
  assert(wrongLogin.statusCode === 401, `wrong password should fail, got ${wrongLogin.statusCode}`);

  const login = await app.inject({ method: 'POST', url: '/api/admin/auth/login', payload: { username, password } });
  assert(login.statusCode === 200, `login should succeed, got ${login.statusCode}`);
  const loginBody = login.json() as ApiResponse<{ token: string }>;
  assert(loginBody.success && loginBody.data.token, 'login should return session token');
  const cookie = login.headers['set-cookie'];
  assert(typeof cookie === 'string' && cookie.includes('HttpOnly'), 'login should set httpOnly cookie');
  const sessionCount = await prisma.adminSession.count({ where: { admin_user_id: adminUser.id } });
  assert(sessionCount >= 1, 'login should create AdminSession');

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

  const alertsNoSession = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts' });
  assert(alertsNoSession.statusCode === 401, `admin logs without session should be 401, got ${alertsNoSession.statusCode}`);
  const alertsWithSession = await app.inject({ method: 'GET', url: '/api/admin/logs/alerts', headers: { cookie: totpCookie } });
  assert(alertsWithSession.statusCode === 200, `admin logs with session should be 200, got ${alertsWithSession.statusCode}`);

  const alert = await prisma.opsAlertLog.create({ data: { alert_type: 'l11_auth_check', alert_level: 'warning', title: 'L11 auth check', message: 'verify alert audit' } });
  const resolve = await app.inject({ method: 'POST', url: `/api/admin/logs/alerts/${alert.id}/resolve`, headers: { cookie: totpCookie }, payload: { resolved_by: 'admin', resolution_note: 'verified' } });
  assert(resolve.statusCode === 200, `alert resolve should succeed, got ${resolve.statusCode}`);
  const alertAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'ops_alert_resolved', target_id: alert.id } });
  assert(alertAudit, 'alert resolve should write AdminAuditLog');

  const leader = await prisma.user.create({ data: { openid: `l11_leader_${Date.now()}`, nickname: 'L11开团人', role: 'leader' } });
  const withdrawal = await prisma.withdrawal.create({ data: { leader_user_id: leader.id, amount_cents: 100, taxable_amount_cents: 100, payable_amount_cents: 100 } });
  const approve = await app.inject({ method: 'POST', url: `/api/admin/withdrawals/${withdrawal.id}/approve`, headers: { cookie: totpCookie }, payload: { reason: 'L11 verification' } });
  assert(approve.statusCode === 200, `withdrawal approve should succeed, got ${approve.statusCode}`);
  const withdrawalAudit = await prisma.adminAuditLog.findFirst({ where: { action: 'withdrawal_approved', target_id: withdrawal.id } });
  assert(withdrawalAudit, 'withdrawal approve should write AdminAuditLog');

  console.log('L11 admin auth verification passed.');
}

main().finally(async () => {
  await app.close();
  await prisma.$disconnect();
});
