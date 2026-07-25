import { adminApiUrl, adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  AdminOrderListQuery,
  AdminOrderListResponse,
  AdminOrderStatusResult,
  AdminPickupVerificationResult,
  AiContext,
} from './types';

function buildAdminOrderListSearch(query: AdminOrderListQuery): string {
  const search = new URLSearchParams();
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.order_type) search.set('order_type', query.order_type);
  if (query.pickup_type) search.set('pickup_type', query.pickup_type);
  if (query.pay_status) search.set('pay_status', query.pay_status);
  if (query.order_status) search.set('order_status', query.order_status);
  if (query.refund_status) search.set('refund_status', query.refund_status);
  search.set('page', String(query.page));
  search.set('page_size', String(query.page_size));
  return search.toString();
}

export function loadOrders(
  query: AdminOrderListQuery,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<AdminOrderListResponse> {
  return request<AdminOrderListResponse>(
    `/api/admin/orders?${buildAdminOrderListSearch(query)}`,
    { signal },
  );
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
  expectedVersion: number,
  idempotencyKey: string,
  request: JsonRequester = adminJsonRequest,
): Promise<AdminOrderStatusResult> {
  return request<AdminOrderStatusResult>(
    `/api/admin/orders/${orderId}/status`,
    {
      method: 'POST',
      body: JSON.stringify({
        next_status: nextStatus,
        expected_version: expectedVersion,
        idempotency_key: idempotencyKey,
      }),
    },
  );
}

export function verifyOrderPickup(
  orderId: string,
  expectedVersion: number,
  idempotencyKey: string,
  adminRemark: string,
  request: JsonRequester = adminJsonRequest,
): Promise<AdminPickupVerificationResult> {
  return request<AdminPickupVerificationResult>(
    `/api/admin/orders/${orderId}/pickup-verify`,
    {
      method: 'POST',
      body: JSON.stringify({
        expected_version: expectedVersion,
        idempotency_key: idempotencyKey,
        admin_remark: adminRemark,
      }),
    },
  );
}

export function getPickingExportUrl(format: 'summary' | 'detail'): string {
  return adminApiUrl(`/api/admin/orders/export/picking.csv?format=${format}`);
}
