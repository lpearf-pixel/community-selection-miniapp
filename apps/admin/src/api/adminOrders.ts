import { getAdminScopeHeaders } from "../access/adminAccess";
type ApiResponse<T> = { success: boolean; data: T; message?: string };
const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${apiBaseUrl}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...getAdminScopeHeaders(), ...(init?.headers ?? {}) } }); const json = (await response.json()) as ApiResponse<T>; if (!json.success) throw new Error(json.message || "Admin request failed"); return json.data; }
export type AdminOrderDetail = {
  order_id: string;
  order_no: string;
  order_type: string;
  product_amount_cents: number;
  delivery_fee_cents: number;
  pay_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  refund_amount_cents: number;
  remaining_refundable_amount_cents: number;
  receiver_phone_masked: string | null;
  receiver_address_masked: string | null;
};

export function getAdminOrderDetail(orderId: string) {
  return fetchJson<AdminOrderDetail>(`/api/admin/orders/${orderId}`);
}
