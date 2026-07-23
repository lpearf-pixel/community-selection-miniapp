import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type { GroupBuy } from '../shared/types';
import type {
  ClosureSummary,
  ClosureWorkbenchData,
  ManualRefundOrderResponse,
} from './types';

export function loadGroupBuys(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<GroupBuy[]> {
  return request<GroupBuy[]>('/api/group-buys', { signal });
}

export async function loadClosureWorkbench(
  groupBuyId: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<ClosureWorkbenchData> {
  const [summary, refundOrders] = await Promise.all([
    request<ClosureSummary>(
      `/api/admin/group-buys/${groupBuyId}/closure-summary`,
      { signal },
    ),
    request<ManualRefundOrderResponse>(
      `/api/admin/group-buys/${groupBuyId}/manual-refund-orders`,
      { signal },
    ),
  ]);

  return { summary, refundOrders: refundOrders.items };
}

export function markGroupBuyFailed(
  groupBuyId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/group-buys/${groupBuyId}/mark-failed`, {
    method: 'POST',
    body: JSON.stringify({
      reason: 'Admin 人工确认团购失败',
      admin_note: '标记失败不等于退款完成',
    }),
  });
}

export function closeUnpaidOrders(
  groupBuyId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/group-buys/${groupBuyId}/close-unpaid-orders`, {
    method: 'POST',
    body: JSON.stringify({ admin_note: '关闭未支付订单不会触发退款' }),
  });
}

export function closeGroupBuy(
  groupBuyId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/group-buys/${groupBuyId}/close`, {
    method: 'POST',
    body: JSON.stringify({ admin_note: '最终关闭要求所有待办已完成' }),
  });
}

export function confirmRefund(
  groupBuyId: string,
  orderId: string,
  refundId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(
    `/api/admin/group-buys/${groupBuyId}/orders/${orderId}/confirm-refund`,
    {
      method: 'POST',
      body: JSON.stringify({
        refund_id: refundId,
        admin_note: '确认退款已完成必须基于成功退款记录',
      }),
    },
  );
}

export function cloneGroupBuy(
  groupBuyId: string,
  input: { end_time: string; pickup_time: string },
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/group-buys/${groupBuyId}/clone`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
