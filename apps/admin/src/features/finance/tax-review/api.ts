import { adminFetch } from '../../../api/adminRequest';
import { adminJsonRequest } from '../../../shared/api/admin-api';
import type { JsonRequester } from '../../../shared/api/client';
import type {
  TaxReviewDetail,
  TaxReviewList,
  TaxReviewPayload,
  TaxReviewQuery,
} from './types';

function queryString(params: TaxReviewQuery): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

export function listTaxReviews(
  params: TaxReviewQuery,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<TaxReviewList> {
  const query = queryString(params);
  return request<TaxReviewList>(
    `/api/admin/tax-records${query ? `?${query}` : ''}`,
    { signal },
  );
}

export function getTaxReviewDetail(
  id: string,
  request: JsonRequester = adminJsonRequest,
  signal?: AbortSignal,
): Promise<TaxReviewDetail> {
  return request<TaxReviewDetail>(`/api/admin/tax-records/${id}`, {
    signal,
  });
}

export function submitTaxReview(
  withdrawalId: string,
  expectedVersion: number,
  payload: TaxReviewPayload,
  request: JsonRequester = adminJsonRequest,
  createIdempotencyKey: () => string = () =>
    `tax-review-${globalThis.crypto.randomUUID()}`,
): Promise<void> {
  const command = {
    ...payload,
    ...(payload.tax_mode === 'invoice'
      ? {}
      : { invoice_status: undefined }),
    idempotency_key: createIdempotencyKey(),
    expected_version: expectedVersion,
  };
  return request<void>(
    `/api/admin/withdrawals/${withdrawalId}/tax-review`,
    {
      method: 'POST',
      body: JSON.stringify(command),
    },
  );
}

export function taxReviewExportPath(params: TaxReviewQuery): string {
  const query = queryString(params);
  return `/api/admin/tax-records/export.csv${query ? `?${query}` : ''}`;
}

export async function downloadTaxReviewCsv(
  params: TaxReviewQuery,
): Promise<string> {
  const response = await adminFetch(taxReviewExportPath(params), {
    json: false,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || '导出失败';
    try {
      const body = JSON.parse(text) as { message?: string };
      message = body.message ?? message;
    } catch {
      // Keep the text response when the endpoint does not return JSON.
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename =
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? 'tax-review.csv';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}
