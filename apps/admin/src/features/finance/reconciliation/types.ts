export type FinanceOverview = {
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  after_sale_case_count: number;
  inventory_loss_estimated_amount: number;
  service_reward_estimated_amount: number;
  tax_review_pending_count: number;
  withdrawal_paid_amount: number;
};

export type FinanceOrderRow = {
  order_id: string;
  order_status: string;
  paid_amount: number;
  refunded_amount: number;
  net_amount: number;
  after_sale_case_count: number;
  commission_reward_amount: number;
};

export type FinanceRewardRow = {
  reward_id: string;
  leader_user_id: string;
  order_id: string;
  reward_amount: number;
  reward_status: string;
  available_at?: string | null;
  withdrawal_id?: string | null;
  recalculated_after_refund: boolean;
};

export type FinanceAfterSaleRow = {
  after_sale_case_id: string;
  order_id: string;
  type: string;
  status: string;
  requested_amount: number;
  approved_amount: number;
  resolved_amount: number;
  linked_inventory_loss_id?: string | null;
};

export type FinanceReconciliationData = {
  overview: FinanceOverview;
  orders: FinanceOrderRow[];
  rewards: FinanceRewardRow[];
  afterSales: FinanceAfterSaleRow[];
};
