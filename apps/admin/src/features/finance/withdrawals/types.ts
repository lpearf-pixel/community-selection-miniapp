export type WithdrawalStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export type Withdrawal = {
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

export type WithdrawalDetail = Withdrawal & {
  manual_reference?: string | null;
  reviewed_by_admin_id?: string | null;
  processed_by_admin_id?: string | null;
  commissions: Array<{
    commission_id: string;
    order_no: string;
    product_name: string;
    community_name: string;
    amount_cents: number;
  }>;
  reward_ledger_events: Array<{
    event_type: string;
    direction: string;
    amount_cents: number;
    affects_available_balance: boolean;
    created_at: string;
  }>;
  admin_audits: Array<{
    action: string;
    admin_user_id?: string | null;
    created_at: string;
  }>;
};

export type WithdrawalList = {
  items: Withdrawal[];
  total: number;
  page: number;
  page_size: number;
};

export type WithdrawalListQuery = {
  status?: string;
  keyword?: string;
  client_request_id?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
};
