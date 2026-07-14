const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

export type WithdrawalStatus = "pending" | "approved" | "rejected" | "paid";
export type AdminWithdrawal = {
  withdrawal_id: string;
  client_request_id?: string | null;
  leader_user_id: string;
  leader_nickname: string;
  leader_phone_masked?: string | null;
  amount_cents: number;
  status: WithdrawalStatus;
  commission_count: number;
  community_names: string[];
  created_at: string;
  reviewed_at?: string | null;
  processed_at?: string | null;
  admin_remark?: string | null;
};
export type AdminWithdrawalDetail = AdminWithdrawal & {
  manual_reference?: string | null;
  reviewed_by_admin_id?: string | null;
  processed_by_admin_id?: string | null;
  commissions: Array<{ commission_id: string; order_no: string; product_name: string; community_name: string; amount_cents: number }>;
  reward_ledger_events: Array<{ event_type: string; direction: string; amount_cents: number; affects_available_balance: boolean; created_at: string }>;
  admin_audits: Array<{ action: string; admin_user_id?: string | null; created_at: string }>;
};
export type AdminWithdrawalList = { items: AdminWithdrawal[]; total: number; page: number; page_size: number };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { "content-type": "application/json", "x-admin-user-id": "admin-dev", "x-admin-role": "finance", ...(init?.headers ?? {}) } });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.message ?? "请求失败");
  return body.data as T;
}

export function listAdminWithdrawals(params: { status?: string; keyword?: string; client_request_id?: string; from?: string; to?: string; page?: number; page_size?: number } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return requestJson<AdminWithdrawalList>(`/api/admin/withdrawals${query.size ? `?${query}` : ""}`);
}
export function getAdminWithdrawal(id: string) { return requestJson<AdminWithdrawalDetail>(`/api/admin/withdrawals/${id}`); }
export function approveWithdrawal(id: string, remark: string) { return requestJson(`/api/admin/withdrawals/${id}/approve`, { method: "POST", body: JSON.stringify({ remark }) }); }
export function rejectWithdrawal(id: string, reason: string) { return requestJson(`/api/admin/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }); }
export function markWithdrawalPaid(id: string, manual_reference: string, remark: string) { return requestJson(`/api/admin/withdrawals/${id}/mark-paid`, { method: "POST", body: JSON.stringify({ manual_reference, remark }) }); }
