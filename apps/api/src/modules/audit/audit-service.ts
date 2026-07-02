import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import {
  raiseOpsAlert,
  recordBusinessEvent,
  recordOrderTimeline,
  safeRaiseOpsAlert,
  safeRecordBusinessEvent,
  safeRecordOrderTimeline
} from '../../services/logging-service.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export { recordBusinessEvent, recordOrderTimeline, raiseOpsAlert, safeRecordBusinessEvent, safeRecordOrderTimeline, safeRaiseOpsAlert };

export async function recordAdminAudit(client: DbClient, input: {
  admin_user_id?: string | null;
  action: string;
  target_type: string;
  target_id: string;
  ip_address?: string | null;
  user_agent?: string | null;
  payload?: unknown;
}) {
  return client.adminAuditLog.create({
    data: {
      admin_user_id: input.admin_user_id ?? null,
      action: input.action,
      target_type: input.target_type,
      target_id: input.target_id,
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ?? null,
      payload: input.payload === undefined ? Prisma.JsonNull : input.payload as Prisma.InputJsonValue
    }
  });
}

export async function recordOpsAlert(client: DbClient, input: Parameters<typeof raiseOpsAlert>[1]) {
  return raiseOpsAlert(client, input);
}
