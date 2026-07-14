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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-admin-user-id": "admin-dev",
      "x-admin-role": "finance",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.message ?? "请求失败");
  return body.data as T;
}

export function listAdminWithdrawals(params: { status?: string; leader_user_id?: string; client_request_id?: string } = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => Boolean(v)) as Array<[string, string]>);
  return requestJson<AdminWithdrawal[]>(`/api/admin/withdrawals${query.size ? `?${query}` : ""}`);
}

export function approveWithdrawal(id: string, remark: string) {
  return requestJson(`/api/admin/withdrawals/${id}/approve`, { method: "POST", body: JSON.stringify({ remark }) });
}
export function rejectWithdrawal(id: string, reason: string) {
  return requestJson(`/api/admin/withdrawals/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
}
export function markWithdrawalPaid(id: string, manual_reference: string, remark: string) {
  return requestJson(`/api/admin/withdrawals/${id}/mark-paid`, { method: "POST", body: JSON.stringify({ manual_reference, remark }) });
}
