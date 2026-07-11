import { getAdminScopeHeaders } from "../access/adminAccess";
type ApiResponse<T> = { success: boolean; data: T; message?: string };
const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${apiBaseUrl}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...getAdminScopeHeaders(), ...(init?.headers ?? {}) } }); const json = (await response.json()) as ApiResponse<T>; if (!json.success) throw new Error(json.message || "Admin request failed"); return json.data; }
export type AdminAfterSale = {
  after_sale_case_id: string;
  order_id: string;
  order_no: string | null;
  type: string;
  status: string;
  requested_refund_cents: number;
  requested_product_refund_cents: number;
  requested_delivery_refund_cents: number;
  approved_refund_cents: number;
  approved_product_refund_cents: number;
  approved_delivery_refund_cents: number;
  admin_note?: string | null;
};

export function listAdminAfterSales(query = '') {
  return fetchJson<AdminAfterSale[]>(`/api/admin/after-sales${query}`);
}

export function getAdminAfterSaleDetail(id: string) {
  return fetchJson<AdminAfterSale>(`/api/admin/after-sales/${id}`);
}

export function reviewAdminAfterSale(id: string, payload: { status: 'approved' | 'rejected' | 'reviewing'; approved_product_refund_cents?: number; approved_delivery_refund_cents?: number; approved_refund_cents?: number; admin_note?: string; resolution_type?: string; responsibility?: string }) {
  return fetchJson<AdminAfterSale>(`/api/admin/after-sales/${id}/review`, { method: 'POST', body: JSON.stringify(payload) });
}
