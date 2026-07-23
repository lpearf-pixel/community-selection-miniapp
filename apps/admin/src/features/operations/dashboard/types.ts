export type OperationsOverview = {
  order_count: number;
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  after_sale_rate: number;
  refund_rate: number;
  pickup_completed_count: number;
  inventory_loss_estimated_amount: number;
  service_reward_amount: number;
};

export type OperationsTrendRow = {
  date: string;
  order_count: number;
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  after_sale_case_count: number;
  inventory_loss_count: number;
  pickup_completed_count: number;
};

export type OperationsProductRow = {
  product_id: string;
  product_name: string;
  category_name: string;
  order_count: number;
  quantity_sold: number;
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  after_sale_rate: number;
  inventory_loss_count: number;
};

export type OperationsCommunityRow = {
  community_id: string;
  community_name: string;
  order_count: number;
  paid_amount: number;
  refunded_amount: number;
  net_sales_amount: number;
  pickup_completed_count: number;
  after_sale_case_count: number;
  active_group_buy_count: number;
};

export type OperationsPickupStoreRow = {
  pickup_store_id: string;
  pickup_store_name: string;
  order_count: number;
  pickup_completed_count: number;
  pickup_pending_count: number;
  pickup_completion_rate: number;
  paid_amount: number;
  after_sale_case_count: number;
};

export type OperationsAlertRow = {
  type: string;
  severity: string;
  title: string;
  description: string;
  metric_value: number;
};

export type OperationsDashboardData = {
  overview: OperationsOverview;
  trends: OperationsTrendRow[];
  products: OperationsProductRow[];
  communities: OperationsCommunityRow[];
  pickupStores: OperationsPickupStoreRow[];
  alerts: OperationsAlertRow[];
};
