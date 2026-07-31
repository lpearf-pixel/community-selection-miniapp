import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { upsertOpsAlert } from '../modules/operations/ops-alert-owner.js';
import { createWechatAccessTokenClient } from '../modules/wechat/wechat-access-token-client.js';
import { loadWechatRuntimeConfig } from '../modules/wechat/wechat-config.js';
import { createWechatShippingClient } from '../modules/wechat-shipping/wechat-shipping-client.js';
import type { WechatShippingClient } from '../modules/wechat-shipping/wechat-shipping-client.js';
import {
  runWechatShippingWorker,
  type WechatShippingWorkItem,
} from '../modules/wechat-shipping/wechat-shipping-worker.js';

const JOB_LOCK_KEY = 'community-selection:l53:wechat-shipping';
const PROCESSING_LEASE_MS = 5 * 60_000;
let runtimeShippingClient: WechatShippingClient | null = null;

type ClaimedIntent = {
  id: string;
  order_id: string;
  logistics_type: number;
  attempt_count: number;
  order: {
    user: { openid: string };
    product: { name: string } | null;
    group_buy: { product: { name: string } } | null;
    payments: Array<{ transaction_id: string | null }>;
  };
};

export function toWechatShippingWorkItem(
  record: ClaimedIntent,
): WechatShippingWorkItem {
  return {
    id: record.id,
    orderId: record.order_id,
    logisticsType: record.logistics_type === 4 ? 4 : 2,
    attemptCount: record.attempt_count,
    transactionId: record.order.payments[0]?.transaction_id ?? '',
    openid: record.order.user.openid,
    itemDescription:
      record.order.product?.name ??
      record.order.group_buy?.product.name ??
      '',
  };
}

async function claimDue(now: Date, limit: number) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${JOB_LOCK_KEY})) AS acquired
    `;
    if (rows[0]?.acquired !== true) return [];

    const claimed = await tx.wechatShippingIntent.findMany({
      where: {
        OR: [
          { status: 'pending' },
          {
            status: 'retryable',
            next_retry_at: { lte: now },
          },
          {
            status: 'processing',
            updated_at: {
              lte: new Date(now.getTime() - PROCESSING_LEASE_MS),
            },
          },
        ],
      },
      include: {
        order: {
          select: {
            user: { select: { openid: true } },
            product: { select: { name: true } },
            group_buy: {
              select: {
                product: { select: { name: true } },
              },
            },
            payments: {
              where: {
                trade_state: 'paid',
                transaction_id: { not: null },
              },
              orderBy: { attempt_no: 'desc' },
              take: 1,
              select: { transaction_id: true },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
      take: Math.min(limit, 20),
    });

    for (const intent of claimed) {
      await tx.wechatShippingIntent.update({
        where: { id: intent.id },
        data: {
          status: 'processing',
          attempt_count: { increment: 1 },
          last_error_code: null,
          next_retry_at: null,
        },
      });
      intent.attempt_count += 1;
    }
    return claimed.map((intent) =>
      toWechatShippingWorkItem(intent as ClaimedIntent),
    );
  });
}

async function recordFailure(
  intentId: string,
  input: {
    status: 'retryable' | 'manual_required';
    code: string;
    nextRetryAt?: Date | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.wechatShippingIntent.update({
      where: { id: intentId },
      data: {
        status: input.status,
        last_error_code: input.code,
        next_retry_at: input.nextRetryAt ?? null,
      },
    });
    await upsertOpsAlert(tx, `wechat-shipping:${intentId}`, {
      alert_type: 'wechat_shipping_sync',
      alert_level:
        input.status === 'manual_required' ? 'error' : 'warning',
      order_id: intent.order_id,
      title:
        input.status === 'manual_required'
          ? '微信发货信息同步需人工处理'
          : '微信发货信息同步等待重试',
      message: input.code,
      payload: {
        intent_id: intent.id,
        status: input.status,
        error_code: input.code,
        attempt_count: intent.attempt_count,
      } as Prisma.InputJsonValue,
    });
  });
}

export async function runWechatShippingJobs(now = new Date()) {
  const config = loadWechatRuntimeConfig();
  if (config.paymentMode !== 'wechat' || config.mockPayment) {
    return {
      claimed: 0,
      succeeded: 0,
      retryable: 0,
      manualRequired: 0,
    };
  }
  if (!runtimeShippingClient) {
    const tokenClient = createWechatAccessTokenClient({
      appId: config.appId,
      appSecret: config.appSecret,
    });
    runtimeShippingClient = createWechatShippingClient({
      getAccessToken: tokenClient.getAccessToken,
    });
  }

  return runWechatShippingWorker(
    {
      claimDue,
      upload: runtimeShippingClient.upload,
      markSucceeded(intentId, completedAt) {
        return prisma.wechatShippingIntent.updateMany({
          where: { id: intentId, status: 'processing' },
          data: {
            status: 'succeeded',
            last_error_code: null,
            next_retry_at: null,
            succeeded_at: completedAt,
          },
        });
      },
      markRetryable(intentId, failure) {
        return recordFailure(intentId, {
          status: 'retryable',
          code: failure.code,
          nextRetryAt: failure.nextRetryAt,
        });
      },
      markManualRequired(intentId, failure) {
        return recordFailure(intentId, {
          status: 'manual_required',
          code: failure.code,
        });
      },
    },
    now,
  );
}

export function startWechatShippingScheduler(options: {
  env?: NodeJS.ProcessEnv;
  run?: () => Promise<unknown>;
  intervalMs?: number;
} = {}) {
  const env = options.env ?? process.env;
  if (
    env.WECHAT_PAY_MODE !== 'wechat' ||
    env.MOCK_WECHAT_PAY === 'true'
  ) {
    return null;
  }
  const runJob = options.run ?? (() => runWechatShippingJobs());
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runJob();
    } finally {
      running = false;
    }
  };
  void run().catch(() => undefined);
  const timer = setInterval(() => {
    void run().catch(() => undefined);
  }, options.intervalMs ?? 60_000);
  timer.unref();
  return timer;
}
