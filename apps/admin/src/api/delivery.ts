export type DeliveryProvider = "self" | "dada" | "manual";
export type DeliveryStatus = "none" | "pending_dispatch" | "assigned" | "delivering" | "delivered" | "delivery_failed" | "canceled";
export type DeliveryMode = "store_pickup" | "store_delivery" | "third_party_delivery";
export type DeliveryReservation = {
  order_id: string; order_no: string; provider: DeliveryProvider; delivery_status: DeliveryStatus; delivery_mode: DeliveryMode;
  pickup_store_id: string | null; pickup_store_name: string | null; sender_address: string | null; receiver_address_masked: string | null;
  receiver_name: string; receiver_phone_masked: string; estimated_distance_km: number | null; delivery_fee_cents: number | null;
  third_party_provider: "dada" | null; third_party_order_no: string | null; can_create_delivery: boolean; created_at: string | null; updated_at: string | null;
};
export type DeliveryProviderItem = { provider: DeliveryProvider; name: string; enabled: boolean; mode: "mock" | "reserved"; description?: string };
type ApiResponse<T> = { success: boolean; data: T; message?: string };
const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";
function buildQuery(params: Record<string, unknown>): string { const q = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && String(v).trim() !== "") q.set(k, String(v)); }); return q.toString(); }
async function readJson<T>(path: string, init?: RequestInit): Promise<T> { const response = await fetch(`${apiBaseUrl}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); const json = (await response.json()) as ApiResponse<T>; if (!json.success) throw new Error(json.message || "配送预留请求失败"); return json.data; }
export function getDeliveryProviders() { return readJson<{ items: DeliveryProviderItem[] }>("/api/admin/delivery/providers"); }
export function getDeliveryOrders(params: { status?: DeliveryStatus; provider?: DeliveryProvider; pickup_store_id?: string; keyword?: string; page?: number; page_size?: number }) { const query = buildQuery(params); return readJson<{ total: number; page: number; page_size: number; items: DeliveryReservation[] }>(`/api/admin/delivery/orders${query ? `?${query}` : ""}`); }
export function reserveDeliveryOrder(orderId: string, body: { provider: DeliveryProvider; delivery_mode: Exclude<DeliveryMode, "store_pickup">; remark?: string }) { return readJson<DeliveryReservation>(`/api/admin/delivery/orders/${orderId}/reserve`, { method: "POST", body: JSON.stringify(body) }); }
export function updateDeliveryOrderStatus(orderId: string, body: { delivery_status: Exclude<DeliveryStatus, "none">; remark?: string }) { return readJson<DeliveryReservation>(`/api/admin/delivery/orders/${orderId}/status`, { method: "POST", body: JSON.stringify(body) }); }
