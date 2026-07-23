export type ClosureSummary = {
  group_buy_id: string;
  status: string;
  expired: boolean;
  target_count: number;
  paid_quantity: number;
  unpaid_order_count: number;
  paid_pending_refund_count: number;
  refund_success_count: number;
  exception_order_count: number;
  pending_refund_amount_cents: number;
  total_refunded_amount_cents: number;
  inventory_deducted_quantity: number;
  inventory_restored_quantity: number;
  inventory_remaining_restorable_quantity: number;
  closable: boolean;
  blockers: Array<{ type: string; count: number; order_ids?: string[] }>;
};

export type ManualRefundOrder = {
  order_id: string;
  order_no: string;
  user_id: string;
  product_id: string;
  quantity: number;
  pay_amount_cents: number;
  product_amount_cents: number;
  delivery_fee_cents: number;
  refund_amount_cents: number;
  refund_status: string;
  latest_refund_id: string | null;
  closure_status: string;
  created_at: string;
  paid_at: string | null;
};

export type ManualRefundOrderResponse = {
  group_buy_id: string;
  group_buy_status: string;
  summary: {
    total_paid_orders: number;
    pending_refund_orders: number;
    refund_success_orders: number;
    exception_orders: number;
    pending_refund_amount_cents: number;
  };
  items: ManualRefundOrder[];
};

export type ClosureWorkbenchData = {
  summary: ClosureSummary;
  refundOrders: ManualRefundOrder[];
};
