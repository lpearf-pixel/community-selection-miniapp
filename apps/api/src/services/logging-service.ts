import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type DbClient = Prisma.TransactionClient | typeof prisma;
type JsonRecord = Record<string, unknown>;

const blockedKeyPattern = /(token|password|private_key|privateKey|secret|cert|certificate|api_v3_key|key)$/i;
const phonePattern = /1[3-9]\d{9}/g;
const identityKeyPattern = /^(openid|unionid)$/i;
const nameKeyPattern = /^(receiver_name|real_name|name)$/i;
const accountKeyPattern = /(bank|card|account_no|account_number)/i;

function maskIdentity(value: string) {
  return value.length <= 10 ? `${value.slice(0, 2)}***${value.slice(-2)}` : `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function maskName(value: string) {
  return value ? `${value.slice(0, 1)}*` : value;
}

function maskAccount(value: string) {
  return value.length <= 4 ? `****${value}` : `****${value.slice(-4)}`;
}

function maskString(value: string, key?: string) {
  if (blockedKeyPattern.test(key ?? '')) return '[FILTERED]';
  if (identityKeyPattern.test(key ?? '')) return maskIdentity(value);
  if (nameKeyPattern.test(key ?? '')) return maskName(value);
  if (accountKeyPattern.test(key ?? '')) return maskAccount(value);
  return value.replace(phonePattern, (phone) => `${phone.slice(0, 3)}****${phone.slice(7)}`);
}

export function sanitizePayload<T = unknown>(payload: T): T {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') return maskString(payload) as T;
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map((item) => sanitizePayload(item)) as T;

  const sanitized: JsonRecord = {};
  for (const [key, value] of Object.entries(payload as JsonRecord)) {
    if (blockedKeyPattern.test(key)) {
      sanitized[key] = '[FILTERED]';
      continue;
    }
    if ((/phone/i.test(key) || identityKeyPattern.test(key) || nameKeyPattern.test(key) || accountKeyPattern.test(key)) && typeof value === 'string') {
      sanitized[key] = maskString(value, key);
      continue;
    }
    if (/address/i.test(key) && typeof value === 'string') {
      sanitized[key] = value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : '***';
      continue;
    }
    sanitized[key] = sanitizePayload(value);
  }
  return sanitized as T;
}

export async function recordBusinessEvent(client: DbClient, input: {
  event_type: string;
  event_level?: 'info' | 'warning' | 'error' | 'critical';
  event_source: string;
  order_id?: string | null;
  group_buy_id?: string | null;
  payment_id?: string | null;
  refund_id?: string | null;
  commission_id?: string | null;
  withdrawal_id?: string | null;
  leader_user_id?: string | null;
  user_id?: string | null;
  trace_id?: string | null;
  request_id?: string | null;
  idempotency_key?: string | null;
  before_snapshot?: unknown;
  after_snapshot?: unknown;
  payload?: unknown;
  message?: string | null;
}) {
  return client.businessEventLog.create({
    data: {
      event_type: input.event_type,
      event_level: input.event_level ?? 'info',
      event_source: input.event_source,
      order_id: input.order_id ?? null,
      group_buy_id: input.group_buy_id ?? null,
      payment_id: input.payment_id ?? null,
      refund_id: input.refund_id ?? null,
      commission_id: input.commission_id ?? null,
      withdrawal_id: input.withdrawal_id ?? null,
      leader_user_id: input.leader_user_id ?? null,
      user_id: input.user_id ?? null,
      trace_id: input.trace_id ?? null,
      request_id: input.request_id ?? null,
      idempotency_key: input.idempotency_key ?? null,
      ...(input.before_snapshot === undefined || input.before_snapshot === null ? {} : { before_snapshot: sanitizePayload(input.before_snapshot) as Prisma.InputJsonValue }),
      ...(input.after_snapshot === undefined || input.after_snapshot === null ? {} : { after_snapshot: sanitizePayload(input.after_snapshot) as Prisma.InputJsonValue }),
      ...(input.payload === undefined || input.payload === null ? {} : { payload: sanitizePayload(input.payload) as Prisma.InputJsonValue }),
      message: input.message ?? null
    }
  });
}

export async function recordOrderTimeline(client: DbClient, input: {
  order_id: string;
  event_type: string;
  title: string;
  message?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  actor_type?: 'system' | 'user' | 'admin' | 'wechat' | 'scheduler';
  actor_user_id?: string | null;
  payload?: unknown;
}) {
  return client.orderTimelineLog.create({
    data: {
      order_id: input.order_id,
      event_type: input.event_type,
      title: input.title,
      message: input.message ?? null,
      from_status: input.from_status ?? null,
      to_status: input.to_status ?? null,
      actor_type: input.actor_type ?? 'system',
      actor_user_id: input.actor_user_id ?? null,
      ...(input.payload === undefined || input.payload === null ? {} : { payload: sanitizePayload(input.payload) as Prisma.InputJsonValue })
    }
  });
}

export async function raiseOpsAlert(client: DbClient, input: {
  alert_type: string;
  alert_level?: 'warning' | 'error' | 'critical';
  order_id?: string | null;
  group_buy_id?: string | null;
  payment_id?: string | null;
  refund_id?: string | null;
  commission_id?: string | null;
  withdrawal_id?: string | null;
  leader_user_id?: string | null;
  title: string;
  message: string;
  payload?: unknown;
}) {
  return client.opsAlertLog.create({
    data: {
      alert_type: input.alert_type,
      alert_level: input.alert_level ?? 'warning',
      status: 'open',
      order_id: input.order_id ?? null,
      group_buy_id: input.group_buy_id ?? null,
      payment_id: input.payment_id ?? null,
      refund_id: input.refund_id ?? null,
      commission_id: input.commission_id ?? null,
      withdrawal_id: input.withdrawal_id ?? null,
      leader_user_id: input.leader_user_id ?? null,
      title: input.title,
      message: input.message,
      ...(input.payload === undefined || input.payload === null ? {} : { payload: sanitizePayload(input.payload) as Prisma.InputJsonValue })
    }
  });
}

export async function resolveOpsAlert(client: DbClient, input: {
  id: string;
  status: 'resolved' | 'ignored';
  resolved_by: string;
  resolution_note: string;
}) {
  return client.opsAlertLog.update({
    where: { id: input.id },
    data: {
      status: input.status,
      resolved_by: input.resolved_by,
      resolution_note: input.resolution_note,
      resolved_at: new Date()
    }
  });
}


export async function safeRecordBusinessEvent(client: DbClient, input: Parameters<typeof recordBusinessEvent>[1]) {
  try {
    return await recordBusinessEvent(client, input);
  } catch (error) {
    console.error('safeRecordBusinessEvent failed', error);
    return null;
  }
}

export async function safeRecordOrderTimeline(client: DbClient, input: Parameters<typeof recordOrderTimeline>[1]) {
  try {
    return await recordOrderTimeline(client, input);
  } catch (error) {
    console.error('safeRecordOrderTimeline failed', error);
    return null;
  }
}

export async function safeRaiseOpsAlert(client: DbClient, input: Parameters<typeof raiseOpsAlert>[1]) {
  try {
    return await raiseOpsAlert(client, input);
  } catch (error) {
    console.error('safeRaiseOpsAlert failed', error);
    return null;
  }
}
