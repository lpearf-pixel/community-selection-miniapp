import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

type AlertInput = {
  alert_type: string;
  alert_level?: 'warning' | 'error' | 'critical';
  order_id?: string | null;
  group_buy_id?: string | null;
  payment_id?: string | null;
  refund_id?: string | null;
  title: string;
  message: string;
  payload?: Prisma.InputJsonValue;
};

export function upsertOpsAlert(
  client: DbClient,
  dedupeKey: string,
  input: AlertInput,
) {
  const data = {
    alert_type: input.alert_type,
    dedupe_key: dedupeKey,
    alert_level: input.alert_level ?? 'warning',
    status: 'open' as const,
    order_id: input.order_id ?? null,
    group_buy_id: input.group_buy_id ?? null,
    payment_id: input.payment_id ?? null,
    refund_id: input.refund_id ?? null,
    title: input.title.slice(0, 200),
    message: input.message.slice(0, 1_000),
    ...(input.payload === undefined ? {} : { payload: input.payload }),
  };
  return client.opsAlertLog.upsert({
    where: { dedupe_key: dedupeKey },
    create: data,
    update: {
      alert_level: data.alert_level,
      status: 'open',
      title: data.title,
      message: data.message,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    },
  });
}
