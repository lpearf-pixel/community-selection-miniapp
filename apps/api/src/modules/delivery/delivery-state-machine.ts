import type { DeliveryFulfillmentStatus } from '@prisma/client';

const transitions: Record<
  DeliveryFulfillmentStatus,
  readonly DeliveryFulfillmentStatus[]
> = {
  pending_dispatch: ['delivering', 'exception'],
  delivering: ['delivered', 'exception'],
  exception: ['pending_dispatch', 'delivering'],
  delivered: [],
};

export function allowedNextDeliveryStatuses(
  current: DeliveryFulfillmentStatus,
): DeliveryFulfillmentStatus[] {
  return [...transitions[current]];
}

export function validateDeliveryTransition(input: {
  current: DeliveryFulfillmentStatus;
  next: DeliveryFulfillmentStatus;
  remark?: string | null;
}): void {
  if (!transitions[input.current].includes(input.next)) {
    throw new Error(
      `配送状态不可从 ${input.current} 变更为 ${input.next}`,
    );
  }
  if (input.next === 'exception' && !input.remark?.trim()) {
    throw new Error('配送异常原因必填');
  }
}
