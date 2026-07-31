import { createHmac } from 'node:crypto';

const MAINLAND_MOBILE = /^1[3-9]\d{9}$/;

export function normalizeMainlandPhone(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let value = String(raw).trim().replace(/[\s-]/g, '');
  if (value.startsWith('+86')) value = value.slice(3);
  else if (value.startsWith('86') && value.length === 13) value = value.slice(2);
  return MAINLAND_MOBILE.test(value) ? value : null;
}

export function maskPhone(phone: string): string {
  if (!MAINLAND_MOBILE.test(phone)) throw new Error('手机号格式无效');
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function fingerprintPhone(phone: string, secret: string): string {
  if (secret.length < 32) {
    throw new Error('MEMBER_PHONE_HMAC_SECRET must be at least 32 characters');
  }
  if (!MAINLAND_MOBILE.test(phone)) throw new Error('手机号格式无效');
  return createHmac('sha256', secret).update(phone, 'utf8').digest('hex');
}
