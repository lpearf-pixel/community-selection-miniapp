export type PickupWorkbenchFilters = {
  date?: string;
  pickup_store_id?: string;
  status?: "paid" | "ready" | "picked" | "completed";
  keyword?: string;
  page?: number;
  page_size?: number;
};

export type PickupWorkbenchOrder = {
  order_id: string;
  order_no: string;
  order_type: string;
  product_name?: string | null;
  product_cover_image?: string | null;
  quantity: number;
  pickup_code: string;
  pickup_status: string;
  pickup_store_id?: string | null;
  pickup_store_name?: string | null;
  pickup_store_address?: string | null;
  pickup_store_phone?: string | null;
  receiver_name: string;
  receiver_phone_masked?: string | null;
  pay_status: string;
  order_status: string;
  paid_at?: string | null;
  picked_at?: string | null;
  completed_at?: string | null;
  created_at: string;
};

export type PickupWorkbenchList = {
  total: number;
  page: number;
  page_size: number;
  items: PickupWorkbenchOrder[];
};

export type PickupWorkbenchSummary = {
  date: string;
  pickup_store_id?: string | null;
  pending_count: number;
  ready_count: number;
  picked_count: number;
  completed_count: number;
  total_quantity: number;
};

export type PickupVerifyResult = {
  order_id: string;
  order_no: string;
  pickup_status: string;
  order_status: string;
  verified_at: string;
  receiver_name: string;
  receiver_phone_masked?: string | null;
  product_name?: string | null;
  quantity: number;
};

type ApiResponse<T> = { success: boolean; data: T; message?: string };

const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

function buildQuery(params: Record<string, unknown>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") query.set(key, String(value));
  });
  return query.toString();
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const json = (await response.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.message || "自提工作台请求失败");
  return json.data;
}

export function getPickupWorkbenchOrders(params: PickupWorkbenchFilters): Promise<PickupWorkbenchList> {
  const query = buildQuery(params);
  return readJson<PickupWorkbenchList>(`/api/admin/pickup/orders${query ? `?${query}` : ""}`);
}

export function getPickupWorkbenchOrderByCode(code: string): Promise<PickupWorkbenchOrder> {
  return readJson<PickupWorkbenchOrder>(`/api/admin/pickup/orders/by-code/${encodeURIComponent(code)}`);
}

export function verifyPickupWorkbenchOrder(orderId: string, pickup_code?: string): Promise<PickupVerifyResult> {
  return readJson<PickupVerifyResult>(`/api/admin/pickup/orders/${orderId}/verify`, { method: "POST", body: JSON.stringify({ pickup_code, remark: "店员自提工作台核销" }) });
}

export function getPickupWorkbenchSummary(params: Pick<PickupWorkbenchFilters, "date" | "pickup_store_id">): Promise<PickupWorkbenchSummary> {
  const query = buildQuery(params);
  return readJson<PickupWorkbenchSummary>(`/api/admin/pickup/summary${query ? `?${query}` : ""}`);
}
