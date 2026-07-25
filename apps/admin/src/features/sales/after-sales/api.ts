import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  AfterSaleCase,
  AfterSaleLossInput,
  AfterSaleRefundExecutionResult,
  AfterSaleResolveInput,
  AfterSaleReviewInput,
} from './types';

export function executeAfterSaleRefund(
  afterSaleId: string,
  expectedVersion: number,
  idempotencyKey: string,
  adminRemark: string,
  request: JsonRequester = adminJsonRequest,
): Promise<AfterSaleRefundExecutionResult> {
  return request<AfterSaleRefundExecutionResult>(
    `/api/admin/after-sales/${afterSaleId}/refund/execute`,
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

export function loadAfterSales(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<AfterSaleCase[]> {
  return request<AfterSaleCase[]>('/api/admin/after-sales', { signal });
}

export function reviewAfterSale(
  afterSaleId: string,
  input: AfterSaleReviewInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/after-sales/${afterSaleId}/review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function resolveAfterSale(
  afterSaleId: string,
  input: AfterSaleResolveInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/after-sales/${afterSaleId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function addAfterSaleNote(
  afterSaleId: string,
  adminNote: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/after-sales/${afterSaleId}/add-note`, {
    method: 'POST',
    body: JSON.stringify({ admin_note: adminNote }),
  });
}

export function linkAfterSaleLoss(
  afterSaleId: string,
  input: AfterSaleLossInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/after-sales/${afterSaleId}/link-loss`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
