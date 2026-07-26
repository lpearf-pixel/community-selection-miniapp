import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  CreatePurchasePlanInput,
  PurchasePlan,
  ReceivePurchasePlanInput,
} from '../../inventory/shared/types';

type PurchaseReceiveDraft = Omit<
  ReceivePurchasePlanInput,
  'idempotency_key'
>;

function defaultPurchaseReceiveKey() {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `purchase-receive-${globalThis.crypto.randomUUID()}`;
  }
  return `purchase-receive-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function createPurchaseReceiveCommand(
  input: PurchaseReceiveDraft,
  keyFactory: () => string = defaultPurchaseReceiveKey,
): ReceivePurchasePlanInput {
  return {
    ...input,
    idempotency_key: keyFactory(),
  };
}

export function loadPurchasePlans(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<PurchasePlan[]> {
  return request<PurchasePlan[]>('/api/admin/purchase-plans', { signal });
}

export function createPurchasePlan(
  input: CreatePurchasePlanInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>('/api/admin/purchase-plans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function confirmPurchasePlan(
  planId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/purchase-plans/${planId}/confirm`, {
    method: 'POST',
  });
}

export function cancelPurchasePlan(
  planId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/purchase-plans/${planId}/cancel`, {
    method: 'POST',
  });
}

export function receivePurchasePlan(
  planId: string,
  input: ReceivePurchasePlanInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/purchase-plans/${planId}/receive`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
