import { adminApiUrl, adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type { Order } from '../shared/types';
import type { AiContext } from './types';

export function loadOrders(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<Order[]> {
  return request<Order[]>('/api/orders', { signal });
}

export function loadOrderAiContext(
  orderId: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<AiContext> {
  return request<AiContext>(`/api/admin/logs/orders/${orderId}/ai-context`, {
    signal,
  });
}

export function updateOrderStatus(
  orderId: string,
  nextStatus: string,
  request: JsonRequester = adminJsonRequest,
): Promise<Order> {
  return request<Order>(`/api/orders/${orderId}/status`, {
    method: 'POST',
    body: JSON.stringify({ next_status: nextStatus }),
  });
}

export function verifyOrderPickup(
  orderId: string,
  adminRemark: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/orders/${orderId}/pickup-verify`, {
    method: 'POST',
    body: JSON.stringify({ admin_remark: adminRemark }),
  });
}

export function getPickingExportUrl(format: 'summary' | 'detail'): string {
  return adminApiUrl(`/api/admin/orders/export/picking.csv?format=${format}`);
}
