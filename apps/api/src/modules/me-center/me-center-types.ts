export type CenterProfileRole = 'user' | 'leader';

export type MeCenterSummary = {
  profile: {
    user_id: string;
    nickname: string | null;
    avatar_url: string | null;
    role: CenterProfileRole;
  };
  orders: {
    total_count: number;
    unpaid_count: number;
    pending_fulfillment_count: number;
    ready_for_pickup_count: number;
    in_delivery_count: number;
    completed_count: number;
  };
  after_sales: {
    pending_count: number;
  };
  navigation: {
    leader_center_available: boolean;
  };
  updated_at: string;
};

export type LeaderCenterWithdrawalItem = {
  withdrawal_id: string;
  amount_cents: number;
  status: string;
  status_text: string;
  created_at: string;
};

export type LeaderCenterSummary = {
  group_buys: {
    total_count: number;
    active_count: number;
    success_count: number;
    failed_count: number;
  };
  rewards: {
    pending_cents: number;
    available_cents: number;
    withdrawing_cents: number;
    withdrawn_cents: number;
  };
  withdrawals: {
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    processed_count: number;
    latest: LeaderCenterWithdrawalItem[];
  };
  navigation: {
    withdrawal_entry_available: boolean;
  };
  updated_at: string;
};

export type RewardLedgerDirectionGroup = {
  direction: string;
  _sum: {
    amount_cents: number | null;
  };
};
