const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

export type TaxReviewRow = {
  tax_record_id: string;
  withdrawal_id: string;
  client_request_id?: string | null;
  leader_user_id?: string | null;
  leader_nickname: string;
  leader_phone_masked?: string | null;
  gross_amount_cents: number;
  taxable_amount_cents: number;
  tax_amount_cents: number;
  payable_amount_cents: number;
  tax_mode: string;
  tax_status: string;
  tax_rate_basis?: string | null;
  invoice_required: boolean;
  invoice_status: string;
  tax_remark?: string | null;
  reviewed_by_admin_id?: string | null;
  reviewed_at?: string | null;
  withdrawal_status?: string | null;
  community_names: string[];
  created_at: string;
  processed_at?: string | null;
};
export type TaxReviewList = { items: TaxReviewRow[]; total: number; page: number; page_size: number };
export type TaxReviewDetail = TaxReviewRow & {
  commissions: Array<{ commission_id: string; order_no: string; community_name: string; product_name: string; reward_amount_cents: number }>;
  admin_audits: Array<{ action: string; admin_user_id?: string | null; created_at: string }>;
  business_events: Array<{ event_type: string; event_level: string; created_at: string }>;
};
export type TaxReviewPayload = {
  tax_mode: string;
  tax_status?: string;
  taxable_amount_cents: number;
  tax_amount_cents: number;
  tax_rate_basis?: string;
  invoice_required?: boolean;
  invoice_status?: string;
  tax_remark?: string;
  client_request_id: string;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-admin-user-id": "admin-dev", "x-admin-role": "finance", ...(init?.headers ?? {}) } });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.message ?? "请求失败");
  return body.data as T;
}

function query(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return query.toString();
}

export function listTaxReview(params: Record<string, unknown>) {
  const qs = query(params);
  return requestJson<TaxReviewList>(`/api/admin/tax-records${qs ? `?${qs}` : ""}`);
}
export function getTaxReviewDetail(id: string) { return requestJson<TaxReviewDetail>(`/api/admin/tax-records/${id}`); }
export function submitTaxReview(withdrawalId: string, payload: TaxReviewPayload) { return requestJson(`/api/admin/withdrawals/${withdrawalId}/tax-review`, { method: "POST", body: JSON.stringify(payload) }); }
export function taxReviewExportUrl(params: Record<string, unknown>) { const qs = query(params); return `${apiBaseUrl}/api/admin/tax-records/export.csv${qs ? `?${qs}` : ""}`; }
