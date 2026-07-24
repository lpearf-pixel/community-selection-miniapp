import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  WithdrawalDetail,
  WithdrawalList,
  WithdrawalListQuery,
} from './types';

function queryString(params: WithdrawalListQuery): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

export function listWithdrawals(
  params: WithdrawalListQuery = {},
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<WithdrawalList> {
  const query = queryString(params);
  return request<WithdrawalList>(
    `/api/admin/withdrawals${query ? `?${query}` : ''}`,
    { signal },
  );
}

export function getWithdrawalDetail(
  id: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<WithdrawalDetail> {
  return request<WithdrawalDetail>(`/api/admin/withdrawals/${id}`, {
    signal,
  });
}

export function approveWithdrawal(
  id: string,
  remark: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/withdrawals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ remark }),
  });
}

export function rejectWithdrawal(
  id: string,
  reason: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/withdrawals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function markWithdrawalPaid(
  id: string,
  manualReference: string,
  remark: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/withdrawals/${id}/mark-paid`, {
    method: 'POST',
    body: JSON.stringify({
      manual_reference: manualReference,
      remark,
    }),
  });
}
