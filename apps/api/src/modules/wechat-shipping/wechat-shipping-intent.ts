import type {
  DeliveryFulfillmentStatus,
  Prisma,
} from '@prisma/client';

export type WechatShippingIntentSeed =
  | {
      trigger: 'delivery_started';
      logisticsType: 2;
    }
  | {
      trigger: 'pickup_verified';
      logisticsType: 4;
    };

export function resolveDeliveryShippingIntent(
  current: DeliveryFulfillmentStatus,
  next: DeliveryFulfillmentStatus,
): WechatShippingIntentSeed | null {
  return current !== 'delivering' && next === 'delivering'
    ? {
        trigger: 'delivery_started',
        logisticsType: 2,
      }
    : null;
}

export function resolvePickupShippingIntent(): WechatShippingIntentSeed {
  return {
    trigger: 'pickup_verified',
    logisticsType: 4,
  };
}

export async function createWechatShippingIntent(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    intent: WechatShippingIntentSeed;
  },
) {
  return tx.wechatShippingIntent.upsert({
    where: { order_id: input.orderId },
    create: {
      order_id: input.orderId,
      trigger: input.intent.trigger,
      logistics_type: input.intent.logisticsType,
    },
    update: {},
  });
}
