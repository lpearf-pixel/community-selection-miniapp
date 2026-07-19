import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type DbClient = Prisma.TransactionClient | typeof prisma;
type JsonRecord = Record<string, unknown>;

type SafeLoggingContext = {
  trace_id?: string | null;
  request_id?: string | null;
};

export type SafeLoggingFailureMetadata = {
  operation: string;
  error_name: string;
  error_code: string;
  trace_id?: string;
  request_id?: string;
};

const blockedKeyPattern =
  /(token|password|private_key|privateKey|secret|cert|certificate|api_v3_key|key)$/i;
const internalReviewKeyPattern =
  /(manual_reference|tax_remark|admin_remark|reviewed_by_admin_id|processed_by_admin_id|resolved_by|admin_user_id)/i;
const phonePattern = /1[3-9]\d{9}/g;
const identityKeyPattern =
  /^(openid|unionid|user_id|leader_user_id)$/i;
const nameKeyPattern = /^(receiver_name|real_name|name)$/i;
const accountKeyPattern = /(bank|card|account_no|account_number)/i;
const correlationIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const stableErrorCodePattern = /^(?:[A-Z][A-Z0-9_]{0,63}|[0-9]{1,10})$/;
const safeErrorNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'PrismaClientKnownRequestError',
  'PrismaClientUnknownRequestError',
  'PrismaClientRustPanicError',
  'PrismaClientInitializationError',
  'PrismaClientValidationError',
]);

const sensitiveTextKeyPattern = new RegExp(
  String.raw`(["']?(?:manual_reference|tax_remark|admin_remark|reviewed_by_admin_id|processed_by_admin_id|resolved_by|admin_user_id|openid|unionid|user_id|leader_user_id|receiver_name|real_name|receiver_address|address|bank_account|bank_account_no|account_number|card_number)["']?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,;\n}\]]+)`,
  'gi',
);

function maskIdentity(value: string) {
  return value.length <= 10
    ? `${value.slice(0, 2)}***${value.slice(-2)}`
    : `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function maskName(value: string) {
  return value ? `${value.slice(0, 1)}*` : value;
}

function maskAccount(value: string) {
  return value.length <= 4 ? `****${value}` : `****${value.slice(-4)}`;
}

function maskPhoneValues(value: string) {
  return value.replace(
    phonePattern,
    (phone) => `${phone.slice(0, 3)}****${phone.slice(7)}`,
  );
}

function maskString(value: string, key?: string) {
  if (internalReviewKeyPattern.test(key ?? '')) return '[FILTERED]';
  if (blockedKeyPattern.test(key ?? '')) return '[FILTERED]';
  if (identityKeyPattern.test(key ?? '')) return maskIdentity(value);
  if (nameKeyPattern.test(key ?? '')) return maskName(value);
  if (accountKeyPattern.test(key ?? '')) return maskAccount(value);
  return maskPhoneValues(value);
}

export function sanitizeLogText<T extends string | null | undefined>(value: T): T {
  if (typeof value !== 'string') return value;
  const phoneMasked = maskPhoneValues(value);
  return phoneMasked.replace(
    sensitiveTextKeyPattern,
    (match, key: string) => {
      const separator = match.includes('=') ? '=' : ':';
      return `${key}${separator}[FILTERED]`;
    },
  ) as T;
}

export function sanitizePayload<T = unknown>(payload: T): T {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') return maskString(payload) as T;
  if (typeof payload === 'bigint') return payload.toString() as T;
  if (typeof payload === 'function' || typeof payload === 'symbol') {
    return undefined as T;
  }
  if (typeof payload !== 'object') return payload;
  if (payload instanceof Date) return payload.toISOString() as T;
  if (Array.isArray(payload)) {
    return payload
      .map((item) => sanitizePayload(item))
      .filter((item) => item !== undefined) as T;
  }

  const maybeJson = payload as { toJSON?: () => unknown };
  if (
    typeof maybeJson.toJSON === 'function' &&
    maybeJson.toJSON !== Object.prototype.toString
  ) {
    const jsonValue = maybeJson.toJSON();
    if (jsonValue !== payload) return sanitizePayload(jsonValue) as T;
  }

  const sanitized: JsonRecord = {};
  for (const [key, value] of Object.entries(payload as JsonRecord)) {
    if (
      key === 'constructor' ||
      typeof value === 'function' ||
      typeof value === 'symbol'
    ) {
      continue;
    }
    if (internalReviewKeyPattern.test(key) || blockedKeyPattern.test(key)) {
      sanitized[key] = '[FILTERED]';
      continue;
    }
    if (
      (/phone/i.test(key) ||
        identityKeyPattern.test(key) ||
        nameKeyPattern.test(key) ||
        accountKeyPattern.test(key)) &&
      typeof value === 'string'
    ) {
      sanitized[key] = maskString(value, key);
      continue;
    }
    if (/address/i.test(key) && typeof value === 'string') {
      sanitized[key] =
        value.length > 6
          ? `${value.slice(0, 3)}***${value.slice(-2)}`
          : '***';
      continue;
    }
    const nextValue = sanitizePayload(value);
    if (nextValue !== undefined) sanitized[key] = nextValue;
  }
  return sanitized as T;
}

function safeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  return safeErrorNames.has(error.name) ? error.name : 'UnknownError';
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return 'UNKNOWN';
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    const trimmed = code.trim();
    return stableErrorCodePattern.test(trimmed) ? trimmed : 'UNKNOWN';
  }
  if (typeof code === 'number' && Number.isSafeInteger(code) && code >= 0) {
    return String(code);
  }
  return 'UNKNOWN';
}

function safeCorrelationId(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return correlationIdPattern.test(trimmed) ? trimmed : undefined;
}

export function safeLoggingFailureMetadata(
  operation: string,
  error: unknown,
  context: SafeLoggingContext = {},
): SafeLoggingFailureMetadata {
  const traceId = safeCorrelationId(context.trace_id);
  const requestId = safeCorrelationId(context.request_id);
  return {
    operation,
    error_name: safeErrorName(error),
    error_code: safeErrorCode(error),
    ...(traceId ? { trace_id: traceId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

export async function recordBusinessEvent(
  client: DbClient,
  input: {
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
  },
) {
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
      ...(input.before_snapshot === undefined || input.before_snapshot === null
        ? {}
        : {
            before_snapshot: sanitizePayload(
              input.before_snapshot,
            ) as Prisma.InputJsonValue,
          }),
      ...(input.after_snapshot === undefined || input.after_snapshot === null
        ? {}
        : {
            after_snapshot: sanitizePayload(
              input.after_snapshot,
            ) as Prisma.InputJsonValue,
          }),
      ...(input.payload === undefined || input.payload === null
        ? {}
        : {
            payload: sanitizePayload(input.payload) as Prisma.InputJsonValue,
          }),
      message: sanitizeLogText(input.message ?? null),
    },
  });
}

export async function recordOrderTimeline(
  client: DbClient,
  input: {
    order_id: string;
    event_type: string;
    title: string;
    message?: string | null;
    from_status?: string | null;
    to_status?: string | null;
    actor_type?: 'system' | 'user' | 'admin' | 'wechat' | 'scheduler';
    actor_user_id?: string | null;
    payload?: unknown;
  },
) {
  return client.orderTimelineLog.create({
    data: {
      order_id: input.order_id,
      event_type: input.event_type,
      title: sanitizeLogText(input.title),
      message: sanitizeLogText(input.message ?? null),
      from_status: input.from_status ?? null,
      to_status: input.to_status ?? null,
      actor_type: input.actor_type ?? 'system',
      actor_user_id: input.actor_user_id ?? null,
      ...(input.payload === undefined || input.payload === null
        ? {}
        : { payload: sanitizePayload(input.payload) as Prisma.InputJsonValue }),
    },
  });
}

export async function raiseOpsAlert(
  client: DbClient,
  input: {
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
  },
) {
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
      title: sanitizeLogText(input.title),
      message: sanitizeLogText(input.message),
      ...(input.payload === undefined || input.payload === null
        ? {}
        : { payload: sanitizePayload(input.payload) as Prisma.InputJsonValue }),
    },
  });
}

export async function resolveOpsAlert(
  client: DbClient,
  input: {
    id: string;
    status: 'resolved' | 'ignored';
    resolved_by: string;
    resolution_note: string;
  },
) {
  return client.opsAlertLog.update({
    where: { id: input.id },
    data: {
      status: input.status,
      resolved_by: '[FILTERED]',
      resolution_note: sanitizeLogText(input.resolution_note),
      resolved_at: new Date(),
    },
  });
}

export async function safeRecordBusinessEvent(
  client: DbClient,
  input: Parameters<typeof recordBusinessEvent>[1],
) {
  try {
    return await recordBusinessEvent(client, input);
  } catch (error) {
    console.error(
      'safe logging operation failed',
      safeLoggingFailureMetadata('recordBusinessEvent', error, {
        trace_id: input.trace_id,
        request_id: input.request_id,
      }),
    );
    return null;
  }
}

export async function safeRecordOrderTimeline(
  client: DbClient,
  input: Parameters<typeof recordOrderTimeline>[1],
) {
  try {
    return await recordOrderTimeline(client, input);
  } catch (error) {
    console.error(
      'safe logging operation failed',
      safeLoggingFailureMetadata('recordOrderTimeline', error),
    );
    return null;
  }
}

export async function safeRaiseOpsAlert(
  client: DbClient,
  input: Parameters<typeof raiseOpsAlert>[1],
) {
  try {
    return await raiseOpsAlert(client, input);
  } catch (error) {
    console.error(
      'safe logging operation failed',
      safeLoggingFailureMetadata('raiseOpsAlert', error),
    );
    return null;
  }
}
