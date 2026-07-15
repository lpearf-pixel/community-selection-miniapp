import { adminFetch, requestAdminJson } from "./adminRequest";

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
  updated_at: string;
};
export type TaxReviewList = { items: TaxReviewRow[]; total: number; page: number; page_size: number };
export type TaxReviewDetail = TaxReviewRow & {
  commissions: Array<{ commission_id: string; order_no: string; community_name: string; product_name: string; reward_amount_cents: number }>;
  admin_audits: Array<{ action: string; admin_user_id?: string | null; created_at: string }>;
  business_events: Array<{ event_type: string; event_level: string; created_at: string }>;
};
export type TaxReviewPayload = {
  tax_mode: string;
  taxable_amount_cents: number;
  tax_amount_cents: number;
  tax_rate_basis?: string;
  invoice_status?: string;
  tax_remark?: string;
  client_request_id: string;
  expected_updated_at: string;
};

function query(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return query.toString();
}

export function listTaxReview(params: Record<string, unknown>) {
  const qs = query(params);
  return requestAdminJson<TaxReviewList>(`/api/admin/tax-records${qs ? `?${qs}` : ""}`);
}
export function getTaxReviewDetail(id: string) { return requestAdminJson<TaxReviewDetail>(`/api/admin/tax-records/${id}`); }
export function submitTaxReview(withdrawalId: string, payload: TaxReviewPayload) { return requestAdminJson(`/api/admin/withdrawals/${withdrawalId}/tax-review`, { method: "POST", body: JSON.stringify(payload) }); }
export async function downloadTaxReviewCsv(params: Record<string, unknown>): Promise<string> {
  const qs = query(params);
  const res = await adminFetch(`/api/admin/tax-records/export.csv${qs ? `?${qs}` : ""}`, { json: false });
  if (!res.ok) {
    const text = await res.text();
    let message = text || "导出失败";
    try { const body = JSON.parse(text); message = body.message ?? message; } catch { /* keep text response */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "tax-review.csv";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}
