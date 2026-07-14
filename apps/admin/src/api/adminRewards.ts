const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? '';

export type RewardItem = {
  commission_id: string;
  order_no: string;
  leader_user_id: string;
  community_name: string;
  product_amount_cents: number;
  product_refund_amount_cents: number;
  estimated_amount_cents: number;
  deduct_amount_cents: number;
  final_amount_cents: number;
  status: string;
  available_at: string | null;
  review_status: string;
  review_note: string | null;
  ledger_summary?: { ledger_count: number };
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-admin-user-id': 'docker-e2e-admin', 'x-admin-role': 'super_admin', ...(init?.headers ?? {}) } });
  const body = await response.json() as { success: boolean; data: T; message?: string };
  if (!response.ok || !body.success) throw new Error(body.message ?? '请求失败');
  return body.data;
}

export function listAdminRewards(params: URLSearchParams) { return requestJson<{ items: RewardItem[] }>('/api/admin/rewards?' + params.toString()); }
export function reviewAdminReward(id: string, body: { review_status: 'verified' | 'needs_follow_up'; review_note?: string }) { return requestJson(`/api/admin/rewards/${id}/review`, { method: 'POST', body: JSON.stringify(body) }); }
export function releaseDueRewards() { return requestJson('/api/admin/rewards/release-due', { method: 'POST', body: '{}' }); }
export function freezeReward(id: string) { return requestJson(`/api/admin/commissions/${id}/freeze`, { method: 'POST', body: '{}' }); }
export function unfreezeReward(id: string) { return requestJson(`/api/admin/commissions/${id}/unfreeze`, { method: 'POST', body: '{}' }); }
