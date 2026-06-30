import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import {
  assertLoginAllowed,
  buildOtpAuthUrl,
  clearLoginFailures,
  clearSessionCookie,
  consumeRecoveryCode,
  createAdminSession,
  createRecoveryCodes,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  hashPassword,
  hashSessionToken,
  readSessionToken,
  recordLoginFailure,
  sessionCookie,
  verifyPassword,
  verifyTotpCode
} from '../services/admin-auth-service.js';

type LoginBody = { username?: string; password?: string; totp_code?: string; recovery_code?: string };
type TotpEnableBody = { totp_code?: string };
type TotpDisableBody = { password?: string; totp_code?: string; recovery_code?: string };

function requestMeta(request: { ip?: string; headers: Record<string, unknown> }) {
  return {
    ip: request.ip,
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined
  };
}

async function writeAdminAuditLog(tx: Prisma.TransactionClient, input: {
  admin_user_id?: string | null;
  action: string;
  target_type?: string;
  target_id?: string;
  ip_address?: string;
  user_agent?: string;
  payload?: unknown;
}) {
  await tx.adminAuditLog.create({
    data: {
      admin_user_id: input.admin_user_id ?? null,
      action: input.action,
      target_type: input.target_type ?? null,
      target_id: input.target_id ?? null,
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ?? null,
      payload: input.payload === undefined ? Prisma.JsonNull : input.payload as Prisma.InputJsonValue
    }
  });
}

async function writeAdminAuditLogSafely(input: {
  admin_user_id?: string | null;
  action: string;
  ip_address?: string;
  user_agent?: string;
  payload?: unknown;
}) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        admin_user_id: input.admin_user_id ?? null,
        action: input.action,
        ip_address: input.ip_address ?? null,
        user_agent: input.user_agent ?? null,
        payload: input.payload === undefined ? Prisma.JsonNull : input.payload as Prisma.InputJsonValue
      }
    });
  } catch (error) {
    console.error('admin audit log write failed', error);
  }
}

export async function requireAdminSession(request: { headers: Record<string, unknown> }) {
  const token = readSessionToken(
    typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
    typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined
  );
  if (!token) return null;
  const session = await prisma.adminSession.findUnique({
    where: { session_token_hash: hashSessionToken(token) },
    include: { admin_user: true }
  });
  if (!session || session.expires_at <= new Date() || session.admin_user.status !== 'active') return null;
  return session.admin_user;
}

export function registerAdminAuthRoutes(app: FastifyInstance) {
  app.post('/api/admin/auth/login', async (request, reply) => {
    const body = request.body as LoginBody;
    const username = body.username?.trim() ?? '';
    const password = body.password ?? '';
    const meta = requestMeta(request);
    try {
      if (!username || !password) throw new Error('缺少用户名或密码');
      assertLoginAllowed(username, meta.ip);
      const adminUser = await prisma.adminUser.findUnique({ where: { username } });
      if (!adminUser || adminUser.status !== 'active' || !(await verifyPassword(password, adminUser.password_hash))) {
        recordLoginFailure(username, meta.ip);
        throw new Error('用户名或密码错误');
      }
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (adminUser.totp_enabled) {
          const secret = adminUser.totp_secret_encrypted ? decryptTotpSecret(adminUser.totp_secret_encrypted) : '';
          const totpOk = verifyTotpCode(secret, body.totp_code);
          const recoveryOk = await consumeRecoveryCode(tx, adminUser.id, body.recovery_code);
          if (!totpOk && !recoveryOk) throw new Error('需要二次验证码或恢复码');
        }
        const session = await createAdminSession(tx, adminUser, meta);
        await writeAdminAuditLog(tx, { admin_user_id: adminUser.id, action: 'admin_login_success', ip_address: meta.ip, user_agent: meta.userAgent });
        return session;
      });
      clearLoginFailures(username, meta.ip);
      reply.header('Set-Cookie', sessionCookie(result.token));
      return ok({ token: result.token, admin_user: { id: adminUser.id, username: adminUser.username, role: adminUser.role, totp_enabled: adminUser.totp_enabled } });
    } catch (error) {
      await writeAdminAuditLogSafely({ action: 'admin_login_failed', ip_address: meta.ip, user_agent: meta.userAgent, payload: { username } });
      reply.code(401);
      return fail(error instanceof Error ? error.message : '登录失败');
    }
  });

  app.post('/api/admin/auth/logout', async (request, reply) => {
    const token = readSessionToken(
      typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
      typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined
    );
    if (token) {
      const session = await prisma.adminSession.findUnique({ where: { session_token_hash: hashSessionToken(token) } });
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.adminSession.deleteMany({ where: { session_token_hash: hashSessionToken(token) } });
        await writeAdminAuditLog(tx, { admin_user_id: session?.admin_user_id ?? null, action: 'admin_logout', ip_address: request.ip, user_agent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : undefined });
      });
    }
    reply.header('Set-Cookie', clearSessionCookie());
    return ok({ logged_out: true });
  });

  app.get('/api/admin/auth/me', async (request, reply) => {
    const adminUser = await requireAdminSession(request);
    if (!adminUser) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    return ok({ id: adminUser.id, username: adminUser.username, role: adminUser.role, totp_enabled: adminUser.totp_enabled });
  });

  app.post('/api/admin/auth/totp/setup', async (request, reply) => {
    const adminUser = await requireAdminSession(request);
    if (!adminUser) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    const secret = generateTotpSecret();
    await prisma.adminUser.update({ where: { id: adminUser.id }, data: { totp_secret_encrypted: encryptTotpSecret(secret), totp_enabled: false } });
    return ok({ otpauth_url: buildOtpAuthUrl(adminUser.username, secret), setup_secret_once: secret });
  });

  app.post('/api/admin/auth/totp/enable', async (request, reply) => {
    const adminUser = await requireAdminSession(request);
    if (!adminUser) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    const body = request.body as TotpEnableBody;
    try {
      if (!adminUser.totp_secret_encrypted) throw new Error('请先初始化二次验证');
      if (!verifyTotpCode(decryptTotpSecret(adminUser.totp_secret_encrypted), body.totp_code)) throw new Error('二次验证码错误');
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const updated = await tx.adminUser.update({ where: { id: adminUser.id }, data: { totp_enabled: true } });
        const recoveryCodes = await createRecoveryCodes(tx, adminUser.id);
        await writeAdminAuditLog(tx, { admin_user_id: adminUser.id, action: 'admin_totp_enabled', target_type: 'AdminUser', target_id: adminUser.id });
        return { updated, recoveryCodes };
      });
      return ok({ admin_user: { id: result.updated.id, username: result.updated.username, totp_enabled: result.updated.totp_enabled }, recovery_codes_once: result.recoveryCodes });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '启用二次验证失败');
    }
  });

  app.post('/api/admin/auth/totp/disable', async (request, reply) => {
    const adminUser = await requireAdminSession(request);
    if (!adminUser) {
      reply.code(401);
      return fail('后台登录已失效');
    }
    const body = request.body as TotpDisableBody;
    try {
      if (!body.password || !(await verifyPassword(body.password, adminUser.password_hash))) throw new Error('当前密码错误');
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const totpOk = !!adminUser.totp_secret_encrypted && verifyTotpCode(decryptTotpSecret(adminUser.totp_secret_encrypted), body.totp_code);
        const recoveryOk = await consumeRecoveryCode(tx, adminUser.id, body.recovery_code);
        if (!totpOk && !recoveryOk) throw new Error('二次验证码或恢复码错误');
        await tx.adminUser.update({ where: { id: adminUser.id }, data: { totp_enabled: false, totp_secret_encrypted: null } });
        await tx.adminRecoveryCode.deleteMany({ where: { admin_user_id: adminUser.id } });
        await writeAdminAuditLog(tx, { admin_user_id: adminUser.id, action: 'admin_totp_disabled', target_type: 'AdminUser', target_id: adminUser.id });
      });
      return ok({ totp_enabled: false });
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '关闭二次验证失败');
    }
  });
}

export { hashPassword };
