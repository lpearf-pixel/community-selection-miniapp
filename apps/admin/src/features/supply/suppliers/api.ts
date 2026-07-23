import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  CreateSupplierInput,
  Supplier,
} from '../../inventory/shared/types';

export function loadSuppliers(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<Supplier[]> {
  return request<Supplier[]>('/api/admin/suppliers', { signal });
}

export function createSupplier(
  input: CreateSupplierInput,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>('/api/admin/suppliers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function disableSupplier(
  supplierId: string,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/suppliers/${supplierId}/disable`, {
    method: 'POST',
  });
}
