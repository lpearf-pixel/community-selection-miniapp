import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { fail, ok } from '@community-selection/shared';
import { prisma } from '../db.js';
import { safeRecordBusinessEvent } from '../services/logging-service.js';
import { appendRewardLedgerEntry, getAvailableRewardBalance } from '../services/commission-service.js';

type ConvertCreditBody = {
  leader_user_id?: string;
  commission_ids?: string[];
  amount_cents?: number;
  client_request_id?: string;
};

function parseAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('转换金额必须大于 0');
  return amount;
}

async function creditBalance(tx: Prisma.TransactionClient, userId: string) {
  const entries = await tx.consumerCreditLedger.findMany({ where: { user_id: userId } });
  return entries.reduce((sum, entry) => sum + (entry.direction === 'in' ? entry.amount_cents : -entry.amount_cents), 0);
}

export function registerRewardRoutes(app: FastifyInstance) {
  app.post('/api/leaders/me/rewards/convert-credit', async (request, reply) => {
    try {
      const body = request.body as ConvertCreditBody;
      if (!body.leader_user_id || !body.commission_ids?.length || !body.client_request_id) {
        throw new Error('缺少转换必填字段');
      }
      if (body.commission_ids.length !== 1) {
        throw new Error('第一版仅支持单笔开团服务奖励转换消费额度');
      }
      const amount = parseAmount(body.amount_cents);
      const commissionId = body.commission_ids[0];

      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.rewardConversion.findUnique({ where: { client_request_id: body.client_request_id } });
        if (existing) {
          if (existing.leader_user_id !== body.leader_user_id || existing.amount_cents !== amount || existing.commission_id !== commissionId) {
            throw new Error('转换幂等键已被使用，且请求参数不一致');
          }
          const taxRecord = existing.tax_record_id ? await tx.taxRecord.findUnique({ where: { id: existing.tax_record_id } }) : null;
          const creditLedgers = await tx.consumerCreditLedger.findMany({ where: { source_type: 'reward_conversion', source_id: existing.id } });
          const rewardLedgers = await tx.rewardLedger.findMany({ where: { conversion_id: existing.id } });
          return { conversion: existing, tax_record: taxRecord, consumer_credit_ledgers: creditLedgers, reward_ledgers: rewardLedgers };
        }

        await safeRecordBusinessEvent(tx, {
          event_type: 'reward_convert_credit_requested',
          event_source: 'rewards-route',
          leader_user_id: body.leader_user_id,
          commission_id: commissionId,
          idempotency_key: body.client_request_id,
          payload: { amount_cents: amount, tax_status: 'pending_review' }
        });

        const commission = await tx.commission.findUnique({ where: { id: commissionId } });
        if (!commission || commission.leader_user_id !== body.leader_user_id) throw new Error('开团服务奖励不存在');
        if (commission.status !== 'available' || commission.withdrawal_id) throw new Error('仅可转换未锁定且可用的开团服务奖励');
        if (commission.final_amount_cents !== amount) throw new Error('第一版仅支持整笔开团服务奖励转换消费额度');

        const taxRecord = await tx.taxRecord.create({
          data: {
            leader_user_id: body.leader_user_id,
            source_type: 'reward_conversion',
            source_id: commission.id,
            tax_mode: 'convert_credit/manual_review',
            tax_status: 'pending_review',
            amount_cents: amount,
            payload: { commission_id: commission.id, note: '转换后税务状态待复核' }
          }
        });

        const conversion = await tx.rewardConversion.create({
          data: {
            leader_user_id: body.leader_user_id,
            commission_id: commission.id,
            client_request_id: body.client_request_id,
            amount_cents: amount,
            conversion_type: 'credit',
            status: 'success',
            tax_status: 'pending_review',
            tax_record_id: taxRecord.id
          }
        });

        const beforeRewardBalance = await getAvailableRewardBalance(tx, body.leader_user_id);
        if (beforeRewardBalance < amount) throw new Error('开团服务奖励可用余额不足');
        const beforeCreditBalance = await creditBalance(tx, body.leader_user_id);
        const rewardLedgerResult = await appendRewardLedgerEntry(tx, {
          leader_user_id: body.leader_user_id,
          commission_id: commission.id,
          conversion_id: conversion.id,
          order_id: commission.order_id,
          event_type: 'convert_credit',
          entry_type: 'convert_credit',
          direction: 'out',
          amount_cents: amount,
          affects_available_balance: true,
          idempotency_key: `convert-credit:${body.client_request_id}`,
          remark: '开团服务奖励转平台消费额度',
          payload: { conversion_id: conversion.id, tax_status: 'pending_review' }
        });
        const rewardLedger = rewardLedgerResult.ledger;
        const creditLedger = await tx.consumerCreditLedger.create({
          data: {
            user_id: body.leader_user_id,
            source_type: 'reward_conversion',
            source_id: conversion.id,
            direction: 'in',
            amount_cents: amount,
            balance_after_cents: beforeCreditBalance + amount,
            usable_scope: 'platform_order',
            remark: '开团服务奖励转平台消费额度',
            payload: { commission_id: commission.id, tax_status: 'pending_review' }
          }
        });
        const updatedCommission = await tx.commission.update({ where: { id: commission.id }, data: { status: 'converted' } });

        await safeRecordBusinessEvent(tx, {
          event_type: 'reward_convert_credit_success',
          event_source: 'rewards-route',
          leader_user_id: body.leader_user_id,
          commission_id: commission.id,
          order_id: commission.order_id,
          idempotency_key: body.client_request_id,
          before_snapshot: commission,
          after_snapshot: updatedCommission,
          payload: {
            conversion_id: conversion.id,
            amount_cents: amount,
            consumer_credit_balance_after_cents: creditLedger.balance_after_cents,
            tax_status: 'pending_review'
          }
        });

        return { conversion, tax_record: taxRecord, consumer_credit_ledgers: [creditLedger], reward_ledgers: [rewardLedger] };
      });

      return ok(result);
    } catch (error) {
      reply.code(400);
      return fail(error instanceof Error ? error.message : '开团服务奖励转换消费额度失败');
    }
  });
}
