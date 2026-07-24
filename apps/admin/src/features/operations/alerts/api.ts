import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type { OperationsAlert } from './types';

const manualResolutionPayload = {
  resolved_by: 'admin',
  resolution_note: '后台人工处理',
};

export function listOperationsAlerts(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<OperationsAlert[]> {
  return request<OperationsAlert[]>('/api/admin/logs/alerts', { signal });
}

export function resolveOperationsAlert(
  id: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/logs/alerts/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify(manualResolutionPayload),
  });
}

export function ignoreOperationsAlert(
  id: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/logs/alerts/${id}/ignore`, {
    method: 'POST',
    body: JSON.stringify(manualResolutionPayload),
  });
}
