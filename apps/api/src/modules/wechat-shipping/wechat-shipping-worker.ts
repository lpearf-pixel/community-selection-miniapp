import {
  buildWechatShippingPayload,
  classifyWechatShippingError,
  type WechatShippingPayload,
} from './wechat-shipping-policy.js';

export type WechatShippingWorkItem = {
  id: string;
  orderId: string;
  logisticsType: 2 | 4;
  attemptCount: number;
  transactionId: string;
  openid: string;
  itemDescription: string;
};

export type WechatShippingWorkerPorts = {
  claimDue(
    now: Date,
    limit: number,
  ): Promise<WechatShippingWorkItem[]>;
  upload(payload: WechatShippingPayload): Promise<void>;
  markSucceeded(intentId: string, now: Date): Promise<unknown>;
  markRetryable(
    intentId: string,
    input: { code: string; nextRetryAt: Date },
  ): Promise<unknown>;
  markManualRequired(
    intentId: string,
    input: { code: string },
  ): Promise<unknown>;
};

export function retryDelayMs(attemptCount: number): number {
  const normalized = Math.max(1, Math.floor(attemptCount));
  return Math.min(2 ** (normalized - 1), 30) * 60_000;
}

export async function runWechatShippingWorker(
  ports: WechatShippingWorkerPorts,
  now = new Date(),
) {
  const items = await ports.claimDue(now, 20);
  const result = {
    claimed: items.length,
    succeeded: 0,
    retryable: 0,
    manualRequired: 0,
  };

  for (const item of items) {
    try {
      const payload = buildWechatShippingPayload(
        {
          transactionId: item.transactionId,
          openid: item.openid,
          itemDescription: item.itemDescription,
          logisticsType: item.logisticsType,
        },
        now,
      );
      await ports.upload(payload);
      await ports.markSucceeded(item.id, now);
      result.succeeded += 1;
    } catch (error) {
      const failure = classifyWechatShippingError(error);
      if (failure.kind === 'retryable') {
        await ports.markRetryable(item.id, {
          code: failure.code,
          nextRetryAt: new Date(
            now.getTime() + retryDelayMs(item.attemptCount),
          ),
        });
        result.retryable += 1;
      } else {
        await ports.markManualRequired(item.id, {
          code: failure.code,
        });
        result.manualRequired += 1;
      }
    }
  }

  return result;
}
