import crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { Prisma, AdminUser } from '@prisma/client';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const attempts = new Map<string, { count: number; firstFailedAt: number }>();
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function hashSessionToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function getLoginAttemptKey(username: string, ip?: string) {
  return `${username.toLowerCase()}@${ip ?? 'unknown'}`;
}

export function assertLoginAllowed(username: string, ip?: string) {
  const key = getLoginAttemptKey(username, ip);
  const current = attempts.get(key);
  if (!current) return;
  if (Date.now() - current.firstFailedAt > LOGIN_WINDOW_MS) {
    attempts.delete(key);
    return;
  }
  if (current.count >= MAX_LOGIN_FAILURES) throw new Error('登录失败次数过多，请稍后再试');
}

export function recordLoginFailure(username: string, ip?: string) {
  const key = getLoginAttemptKey(username, ip);
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || now - current.firstFailedAt > LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 1, firstFailedAt: now });
    return;
  }
  attempts.set(key, { count: current.count + 1, firstFailedAt: current.firstFailedAt });
}

export function clearLoginFailures(username: string, ip?: string) {
  attempts.delete(getLoginAttemptKey(username, ip));
}

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index + 5 <= bits.length; index += 5) output += base32Alphabet[parseInt(bits.slice(index, index + 5), 2)];
  return output;
}

function decodeBase32(value: string) {
  const clean = value.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (const char of clean) {
    const idx = base32Alphabet.indexOf(char);
    if (idx < 0) throw new Error('TOTP 密钥格式不合法');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function generateTotpCode(secret: string, at = Date.now()) {
  return hotp(secret, Math.floor(at / 30_000));
}

export function verifyTotpCode(secret: string, code?: string) {
  if (!code || !/^\d{6}$/.test(code)) return false;
  const now = Date.now();
  return [-1, 0, 1].some((window) => generateTotpCode(secret, now + window * 30_000) === code);
}

function encryptionKey() {
  const source = process.env.ADMIN_TOTP_ENCRYPTION_KEY || process.env.ADMIN_TOKEN || 'local-admin-totp-development-key';
  return crypto.createHash('sha256').update(source).digest();
}

export function encryptTotpSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes-256-gcm:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptTotpSecret(value: string) {
  const [scheme, ivText, tagText, encryptedText] = value.split(':');
  if (scheme !== 'aes-256-gcm' || !ivText || !tagText || !encryptedText) throw new Error('TOTP 密钥格式不合法');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

export function buildOtpAuthUrl(username: string, secret: string) {
  const issuer = encodeURIComponent('Community Selection Admin');
  const account = encodeURIComponent(username);
  return `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function createRecoveryCodes(tx: Prisma.TransactionClient, adminUserId: string) {
  await tx.adminRecoveryCode.deleteMany({ where: { admin_user_id: adminUserId, used_at: null } });
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').match(/.{1,5}/g)?.join('-') ?? crypto.randomBytes(5).toString('hex'));
  await tx.adminRecoveryCode.createMany({
    data: await Promise.all(codes.map(async (code) => ({ admin_user_id: adminUserId, code_hash: await bcrypt.hash(code, 12) })))
  });
  return codes;
}

export async function consumeRecoveryCode(tx: Prisma.TransactionClient, adminUserId: string, recoveryCode?: string) {
  if (!recoveryCode) return false;
  const codes = await tx.adminRecoveryCode.findMany({ where: { admin_user_id: adminUserId, used_at: null }, orderBy: { created_at: 'asc' } });
  for (const code of codes) {
    if (await bcrypt.compare(recoveryCode, code.code_hash)) {
      await tx.adminRecoveryCode.update({ where: { id: code.id }, data: { used_at: new Date() } });
      return true;
    }
  }
  return false;
}

export async function createAdminSession(tx: Prisma.TransactionClient, adminUser: AdminUser, meta: { ip?: string; userAgent?: string }) {
  const token = createSessionToken();
  const session = await tx.adminSession.create({
    data: {
      admin_user_id: adminUser.id,
      session_token_hash: hashSessionToken(token),
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
      ip_address: meta.ip,
      user_agent: meta.userAgent
    }
  });
  await tx.adminUser.update({ where: { id: adminUser.id }, data: { last_login_at: new Date() } });
  return { token, session };
}


export async function verifySession(tx: Prisma.TransactionClient, token?: string) {
  if (!token) return null;
  const session = await tx.adminSession.findUnique({
    where: { session_token_hash: hashSessionToken(token) },
    include: { admin_user: true }
  });
  if (!session || session.expires_at <= new Date() || session.admin_user.status !== 'active') return null;
  return session;
}

export function setupTotp(username: string) {
  const secret = generateTotpSecret();
  return { secret, encrypted_secret: encryptTotpSecret(secret), otpauth_url: buildOtpAuthUrl(username, secret) };
}

export function sessionCookie(token: string, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `admin_session=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

export function readSessionToken(cookieHeader?: string, authorization?: string) {
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  const cookie = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith('admin_session='));
  return cookie ? decodeURIComponent(cookie.slice('admin_session='.length)) : undefined;
}
