import { readFileSync } from 'node:fs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { createWechatGroupExpiryCommand } from '../modules/group-buy/wechat-group-expiry-command.js';
import { upsertOpsAlert } from '../modules/operations/ops-alert-owner.js';
import { createWechatRefundCommand } from '../modules/refund/wechat-refund-command.js';
import {
  createWechatReconciler,
  reconcileWechatState,
} from '../modules/wechat/wechat-reconciler.js';
import { loadWechatRuntimeConfig } from '../modules/wechat/wechat-config.js';
import { createWechatPayV3Client } from '../modules/wechat/wechat-pay-v3-client.js';
import { markOrderPaid } from './payment-service.js';
import {
  createWechatRefundIntent,
  markRefundSuccess,
  saveWechatRefundProviderResult,
} from './refund-service.js';

const JOB_LOCK_KEY = 'community-selection:l51:wechat-jobs';

function stringField(
  value: unknown,
  errorCode: string,
): string {
  if (typeof value !== 'string' || !value) throw new Error(errorCode);
  return value;
}

async function acquireJobLock(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(hashtext(${JOB_LOCK_KEY})) AS acquired
  `;
  return rows[0]?.acquired === true;
}

function runtimeClients() {
  const config = loadWechatRuntimeConfig();
  if (config.paymentMode !== 'wechat') {
    throw new Error('WECHAT_PAYMENT_MODE_DISABLED');
  }
  const payClient = createWechatPayV3Client({
    appId: config.appId,
    merchantId: config.merchantId,
    serialNo: config.merchantSerialNo,
    privateKey: readFileSync(config.merchantPrivateKeyPath),
    platformSerialNo: config.platformSerialNo,
    platformPublicKey: readFileSync(config.platformCertificatePath),
    paymentNotifyUrl: config.paymentNotifyUrl,
    refundNotifyUrl: config.refundNotifyUrl,
  });
  const refundCommand = createWechatRefundCommand({
    createIntent: createWechatRefundIntent,
    applyRefund: payClient.applyRefund,
    saveProviderResult: saveWechatRefundProviderResult,
  });
  return { payClient, refundCommand };
}

export async function runWechatCommerceJobs(now = new Date()) {
  const { payClient, refundCommand } = runtimeClients();
  return prisma.$transaction(
    async (tx) => {
      const acquireLock = () => acquireJobLock(tx);
      const alert = (
        key: string,
        input: Record<string, unknown>,
      ) =>
        upsertOpsAlert(tx, key, {
          alert_type: 'wechat_commerce_reconcile',
          alert_level: 'error',
          payment_id:
            typeof input.payment_id === 'string'
              ? input.payment_id
              : null,
          refund_id:
            typeof input.refund_id === 'string' ? input.refund_id : null,
          group_buy_id:
            typeof input.group_buy_id === 'string'
              ? input.group_buy_id
              : null,
          order_id:
            typeof input.order_id === 'string' ? input.order_id : null,
          title: '微信交易后台任务异常',
          message: key,
          payload: input as Prisma.InputJsonValue,
        });
      const reconciler = createWechatReconciler({
        acquireLock,
        listPendingPayments(scanAt) {
          return tx.payment.findMany({
            where: {
              trade_state: { in: ['created', 'prepay', 'USERPAYING'] },
              OR: [
                { last_reconciled_at: null },
                {
                  last_reconciled_at: {
                    lte: new Date(scanAt.getTime() - 30_000),
                  },
                },
              ],
            },
            orderBy: { created_at: 'asc' },
            take: 50,
          });
        },
        queryTransaction: payClient.queryTransaction,
        markOrderPaid,
        updatePaymentState(paymentId, state, scanAt, errorCode) {
          return tx.payment.update({
            where: { id: paymentId },
            data: {
              ...(state ? { trade_state: state } : {}),
              last_reconciled_at: scanAt,
              reconcile_attempts: { increment: 1 },
              last_provider_error_code: errorCode,
            },
          });
        },
        listPendingRefunds(scanAt) {
          return tx.refund.findMany({
            where: {
              status: { in: ['pending', 'processing'] },
              OR: [
                { last_reconciled_at: null },
                {
                  last_reconciled_at: {
                    lte: new Date(scanAt.getTime() - 30_000),
                  },
                },
              ],
            },
            orderBy: { created_at: 'asc' },
            take: 50,
          });
        },
        queryRefund: payClient.queryRefund,
        markRefundSuccess,
        updateRefundState(refundId, state, scanAt, errorCode) {
          return tx.refund.update({
            where: { id: refundId },
            data: {
              ...(state ? { provider_status: state } : {}),
              last_reconciled_at: scanAt,
              reconcile_attempts: { increment: 1 },
              last_provider_error_code: errorCode,
            },
          });
        },
        upsertAlert: alert,
      });
      const reconciliation = await reconcileWechatState(reconciler, now);

      const expiry = createWechatGroupExpiryCommand({
        acquireLock: async () => !reconciliation.skipped,
        listDueGroups(scanAt) {
          return tx.groupBuy.findMany({
            where: {
              status: 'pending',
              end_time: { lte: scanAt },
            },
            include: {
              orders: {
                include: {
                  payments: {
                    orderBy: { attempt_no: 'desc' },
                  },
                },
              },
            },
            orderBy: { end_time: 'asc' },
            take: 20,
          });
        },
        queryTransaction: payClient.queryTransaction,
        async convergePayment(order, payment, provider) {
          await markOrderPaid(order.id, {
            payment_id: payment.id,
            out_trade_no: payment.out_trade_no,
            transaction_id: stringField(
              provider.transaction_id,
              'WECHAT_PAYMENT_QUERY_TRANSACTION_ID_INVALID',
            ),
            provider_success_at: new Date(
              stringField(
                provider.success_time,
                'WECHAT_PAYMENT_QUERY_SUCCESS_TIME_INVALID',
              ),
            ),
          });
        },
        async refreshGroupProgress(groupId) {
          const aggregate = await tx.order.aggregate({
            where: {
              group_buy_id: groupId,
              pay_status: 'paid',
              refund_status: { not: 'success' },
              order_status: { notIn: ['closed', 'refunded'] },
            },
            _sum: { quantity: true },
          });
          const paidOrders = await tx.order.findMany({
            where: {
              group_buy_id: groupId,
              pay_status: 'paid',
              refund_status: { not: 'success' },
              order_status: { notIn: ['closed', 'refunded'] },
            },
            select: { id: true, pay_amount_cents: true },
          });
          return {
            paid_quantity: aggregate._sum.quantity ?? 0,
            paid_orders: paidOrders,
          };
        },
        closeUnpaidOrders(groupId) {
          return tx.order.updateMany({
            where: {
              group_buy_id: groupId,
              pay_status: 'unpaid',
              order_status: { not: 'closed' },
            },
            data: { order_status: 'closed' },
          }).then(() => undefined);
        },
        markGroupSuccess(groupId, paidQuantity) {
          return tx.groupBuy.update({
            where: { id: groupId },
            data: {
              status: 'success',
              current_quantity: paidQuantity,
            },
          }).then(() => undefined);
        },
        markGroupFailed(groupId, paidQuantity) {
          return tx.groupBuy.update({
            where: { id: groupId },
            data: {
              status: 'failed',
              current_quantity: paidQuantity,
            },
          }).then(() => undefined);
        },
        submitRefund: refundCommand.submit,
        upsertAlert: alert,
      });
      const expiryResult = await expiry.expire(now);
      return { reconciliation, expiry: expiryResult };
    },
    { timeout: 60_000 },
  );
}

export function startWechatCommerceScheduler() {
  if (
    process.env.WECHAT_PAY_MODE !== 'wechat' ||
    process.env.MOCK_WECHAT_PAY === 'true'
  ) {
    return null;
  }
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runWechatCommerceJobs();
    } finally {
      running = false;
    }
  };
  void run().catch(() => undefined);
  const timer = setInterval(() => {
    void run().catch(() => undefined);
  }, 60_000);
  timer.unref();
  return timer;
}
