import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { publicCurrentUserError } from '../modules/current-user/current-user-security.js';
import { safeRecordBusinessEvent } from '../services/logging-service.js';
import {
  appendRewardLedgerEntry,
  getAvailableRewardBalance,
} from '../services/commission-service.js';
import { withCurrentLeader } from './current-user-route.js';

type ConvertCreditBody = {
  commission_ids?: string[];
  amount_cents?: number;
  client_request_id?: string;
};

export type RewardConversionDto = {
  conversion_id: string;
  commission_id: string;
  amount_cents: number;
  status: string;
  tax_status: string;
  consumer_credit_balance_after_cents: number;
  created_at: string;
  idempotent: boolean;
};

function parseAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw publicCurrentUserError('转换金额必须大于 0', 400);
  }
  return amount;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toRewardConversionDto(
  conversion: {
    id: string;
    commission_id: string;
    amount_cents: number;
    status: string;
    tax_status: string;
    created_at: Date | string;
  },
  consumerCreditBalanceAfterCents: number,
  idempotent: boolean,
): RewardConversionDto {
  return {
    conversion_id: conversion.id,
    commission_id: conversion.commission_id,
    amount_cents: conversion.amount_cents,
    status: conversion.status,
    tax_status: conversion.tax_status,
    consumer_credit_balance_after_cents: consumerCreditBalanceAfterCents,
    created_at: iso(conversion.created_at),
    idempotent,
  };
}

async function creditBalance(tx: Prisma.TransactionClient, userId: string) {
  const entries = await tx.consumerCreditLedger.findMany({
    where: { user_id: userId },
  });
  return entries.reduce(
    (sum, entry) =>
      sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents),
    0,
  );
}

export function registerRewardRoutes(app: FastifyInstance) {
  app.post('/api/leaders/me/rewards/convert-credit', (request, reply) =>
    withCurrentLeader(
      request,
      reply,
      '开团服务奖励转换消费额度失败',
      async (leader) => {
        const body = request.body as ConvertCreditBody;
        const clientRequestId = String(body.client_request_id ?? '').trim();
        const commissionIds = Array.from(
          new Set((body.commission_ids ?? []).map(String).filter(Boolean)),
        );
        if (!clientRequestId || commissionIds.length === 0) {
          throw publicCurrentUserError('缺少转换必填字段', 400);
        }
        if (clientRequestId.length > 80) {
          throw publicCurrentUserError(
            'client_request_id 长度不能超过 80',
            400,
          );
        }
        if (commissionIds.length !== 1) {
          throw publicCurrentUserError(
            '第一版仅支持单笔开团服务奖励转换消费额度',
            400,
          );
        }

        const amount = parseAmount(body.amount_cents);
        const commissionId = commissionIds[0];

        try {
          return await prisma.$transaction(
            async (tx: Prisma.TransactionClient): Promise<RewardConversionDto> => {
              const existing = await tx.rewardConversion.findUnique({
                where: { client_request_id: clientRequestId },
              });
              if (existing) {
                if (
                  existing.leader_user_id !== leader.id ||
                  existing.amount_cents !== amount ||
                  existing.commission_id !== commissionId
                ) {
                  throw publicCurrentUserError(
                    '转换幂等键已被使用，且请求参数不一致',
                    409,
                  );
                }
                const creditLedger =
                  await tx.consumerCreditLedger.findFirst({
                    where: {
                      source_type: 'reward_conversion',
                      source_id: existing.id,
                    },
                    orderBy: { created_at: 'desc' },
                    select: { balance_after_cents: true },
                  });
                const balanceAfter =
                  creditLedger?.balance_after_cents ??
                  (await creditBalance(tx, leader.id));
                return toRewardConversionDto(existing, balanceAfter, true);
              }

              const commission = await tx.commission.findFirst({
                where: { id: commissionId, leader_user_id: leader.id },
              });
              if (!commission) {
                throw publicCurrentUserError('开团服务奖励不存在', 404);
              }
              if (
                commission.status !== 'available' ||
                commission.withdrawal_id
              ) {
                throw publicCurrentUserError(
                  '仅可转换未锁定且可用的开团服务奖励',
                  409,
                );
              }
              if (commission.final_amount_cents !== amount) {
                throw publicCurrentUserError(
                  '第一版仅支持整笔开团服务奖励转换消费额度',
                  400,
                );
              }

              await safeRecordBusinessEvent(tx, {
                event_type: 'reward_convert_credit_requested',
                event_source: 'rewards-route',
                leader_user_id: leader.id,
                commission_id: commissionId,
                idempotency_key: clientRequestId,
                payload: {
                  amount_cents: amount,
                  tax_status: 'pending_review',
                },
              });

              const taxRecord = await tx.taxRecord.create({
                data: {
                  leader_user_id: leader.id,
                  source_type: 'reward_conversion',
                  source_id: commission.id,
                  tax_mode: 'convert_credit/manual_review',
                  tax_status: 'pending_review',
                  amount_cents: amount,
                  payload: {
                    commission_id: commission.id,
                    note: '转换后税务状态待复核',
                  },
                },
              });

              const conversion = await tx.rewardConversion.create({
                data: {
                  leader_user_id: leader.id,
                  commission_id: commission.id,
                  client_request_id: clientRequestId,
                  amount_cents: amount,
                  conversion_type: 'credit',
                  status: 'success',
                  tax_status: 'pending_review',
                  tax_record_id: taxRecord.id,
                },
              });

              const beforeRewardBalance = await getAvailableRewardBalance(
                tx,
                leader.id,
              );
              if (beforeRewardBalance < amount) {
                throw publicCurrentUserError(
                  '开团服务奖励可用余额不足',
                  409,
                );
              }
              const beforeCreditBalance = await creditBalance(tx, leader.id);
              await appendRewardLedgerEntry(tx, {
                leader_user_id: leader.id,
                commission_id: commission.id,
                conversion_id: conversion.id,
                order_id: commission.order_id,
                event_type: 'convert_credit',
                entry_type: 'convert_credit',
                direction: 'out',
                amount_cents: amount,
                affects_available_balance: true,
                idempotency_key: `convert-credit:${clientRequestId}`,
                remark: '开团服务奖励转平台消费额度',
                payload: {
                  conversion_id: conversion.id,
                  tax_status: 'pending_review',
                },
              });
              const creditLedger = await tx.consumerCreditLedger.create({
                data: {
                  user_id: leader.id,
                  source_type: 'reward_conversion',
                  source_id: conversion.id,
                  direction: 'in',
                  amount_cents: amount,
                  balance_after_cents: beforeCreditBalance + amount,
                  usable_scope: 'platform_order',
                  remark: '开团服务奖励转平台消费额度',
                  payload: {
                    commission_id: commission.id,
                    tax_status: 'pending_review',
                  },
                },
              });
              const updatedCommission = await tx.commission.update({
                where: { id: commission.id },
                data: { status: 'converted' },
              });

              await safeRecordBusinessEvent(tx, {
                event_type: 'reward_convert_credit_success',
                event_source: 'rewards-route',
                leader_user_id: leader.id,
                commission_id: commission.id,
                order_id: commission.order_id,
                idempotency_key: clientRequestId,
                before_snapshot: commission,
                after_snapshot: updatedCommission,
                payload: {
                  conversion_id: conversion.id,
                  amount_cents: amount,
                  consumer_credit_balance_after_cents:
                    creditLedger.balance_after_cents,
                  tax_status: 'pending_review',
                },
              });

              return toRewardConversionDto(
                conversion,
                creditLedger.balance_after_cents,
                false,
              );
            },
          );
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw publicCurrentUserError(
              '转换请求正在处理，请稍后查询',
              409,
            );
          }
          throw error;
        }
      },
    ),
  );
}
