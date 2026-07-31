import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  CreateSupplierInput,
  Supplier,
  SupplierComplianceState,
  SupplierQualificationSummary,
} from '../../inventory/shared/types';

export type SupplierSubjectProfile = {
  subject_type: string;
  source_address: string | null;
  market_name: string | null;
  stall_no: string | null;
};

export type SubmitSupplierQualificationInput = {
  qualification_type: string;
  object_key: string;
  file_sha256: string;
  issued_at: string | null;
  valid_from: string | null;
  expires_at: string | null;
  masked_summary: Record<string, string>;
  idempotency_key: string;
};

export function loadSuppliers(
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<Supplier[]> {
  return request<Supplier[]>('/api/admin/suppliers', { signal });
}

export function loadSupplierCompliance(
  supplierId: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<SupplierComplianceState> {
  return request<SupplierComplianceState>(
    `/api/admin/suppliers/${supplierId}/compliance`,
    { signal },
  );
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

export function updateSupplierSubjectProfile(
  supplierId: string,
  subjectProfile: SupplierSubjectProfile,
  request: JsonRequester = adminJsonRequest,
): Promise<void> {
  return request<void>(`/api/admin/suppliers/${supplierId}/update`, {
    method: 'POST',
    body: JSON.stringify({ subject_profile: subjectProfile }),
  });
}

export function submitSupplierQualification(
  supplierId: string,
  input: SubmitSupplierQualificationInput,
  request: JsonRequester = adminJsonRequest,
): Promise<SupplierQualificationSummary> {
  return request<SupplierQualificationSummary>(
    `/api/admin/suppliers/${supplierId}/qualifications/submit`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function reviewSupplierQualification(
  qualificationId: string,
  decision: 'approve' | 'reject',
  reviewNote: string,
  idempotencyKey: string,
  request: JsonRequester = adminJsonRequest,
): Promise<SupplierQualificationSummary> {
  return request<SupplierQualificationSummary>(
    `/api/admin/supplier-qualifications/${qualificationId}/review`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision,
        expected_status: 'submitted',
        review_note: reviewNote,
        idempotency_key: idempotencyKey,
      }),
    },
  );
}
