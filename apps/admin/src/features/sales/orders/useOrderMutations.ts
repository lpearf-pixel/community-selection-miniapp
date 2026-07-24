import { useRef, useState } from 'react';
import { AdminApiError } from '../../../shared/api/errors';
import { updateOrderStatus, verifyOrderPickup } from './api';
import type { AdminOrderListItem } from './types';

const PICKUP_CONFLICT_CODES: ReadonlySet<string> = new Set([
  'ADMIN_ORDER_VERSION_CONFLICT',
  'ADMIN_PICKUP_TYPE_CONFLICT',
  'ADMIN_PICKUP_STATE_CONFLICT',
]);

type OrderMutationOptions = {
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
  onConflict: () => void;
};

export function useOrderMutations(options: OrderMutationOptions) {
  const [pendingPickupOrderIds, setPendingPickupOrderIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const pendingPickupOrderIdsRef = useRef<Set<string>>(new Set());

  const reportConflict = () => {
    options.onMessage('订单已被其他操作更新，已刷新列表，请重试');
    options.onConflict();
  };

  const pickupVerify = async (order: AdminOrderListItem) => {
    if (pendingPickupOrderIdsRef.current.has(order.id)) return;

    pendingPickupOrderIdsRef.current.add(order.id);
    setPendingPickupOrderIds((current) => {
      const next = new Set(current);
      next.add(order.id);
      return next;
    });

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
      reportConflict();
    } finally {
      pendingPickupOrderIdsRef.current.delete(order.id);
      setPendingPickupOrderIds((current) => {
        const next = new Set(current);
        next.delete(order.id);
        return next;
      });
    }
  };

  const markOrder = async (order: AdminOrderListItem, nextStatus: string) => {
    try {
      await updateOrderStatus(
        order.id,
        nextStatus,
        order.version,
        crypto.randomUUID(),
      );
      options.onMessage(`订单 ${order.order_no} 已更新为 ${nextStatus}`);
      options.onMutationCommitted();
    } catch (error) {
      if (
        !(error instanceof AdminApiError) ||
        error.code !== 'ADMIN_ORDER_VERSION_CONFLICT'
      ) throw error;
      reportConflict();
    }
  };

  return { markOrder, pendingPickupOrderIds, pickupVerify };
}
