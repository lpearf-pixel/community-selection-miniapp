import { useRef, useState } from 'react';
import { AdminApiError } from '../../../shared/api/errors';
import { verifyOrderPickup } from './api';
import type { AdminOrderListItem } from './types';

const PICKUP_CONFLICT_CODES: ReadonlySet<string> = new Set([
  'ADMIN_ORDER_VERSION_CONFLICT',
  'ADMIN_PICKUP_TYPE_CONFLICT',
  'ADMIN_PICKUP_STATE_CONFLICT',
]);

type PickupVerificationOptions = {
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
  onConflict: () => void;
};

export function usePickupVerification(options: PickupVerificationOptions) {
  const [pendingPickupOrderIds, setPendingPickupOrderIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const pendingPickupOrderIdsRef = useRef<Set<string>>(new Set());

  const verifyPickup = async (order: AdminOrderListItem) => {
    if (pendingPickupOrderIdsRef.current.has(order.id)) return;

    pendingPickupOrderIdsRef.current.add(order.id);
    setPendingPickupOrderIds((current) => new Set(current).add(order.id));

    try {
      await verifyOrderPickup(
        order.id,
        order.version,
        crypto.randomUUID(),
        '后台核销自提',
      );
      options.onMessage(`订单 ${order.order_no} 已核销自提`);
      options.onMutationCommitted();
    } catch (error) {
      if (
        !(error instanceof AdminApiError) ||
        !PICKUP_CONFLICT_CODES.has(error.code)
      ) throw error;
      options.onMessage('订单已被其他操作更新，已刷新列表，请重试');
      options.onConflict();
    } finally {
      pendingPickupOrderIdsRef.current.delete(order.id);
      setPendingPickupOrderIds((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
    }
  };

  return { pendingPickupOrderIds, verifyPickup };
}
