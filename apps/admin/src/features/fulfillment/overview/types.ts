export type FulfillmentOverview = {
  today_group_buys: number;
  pending_prepare_orders: number;
  ready_pickup_orders: number;
  picked_orders: number;
  completed_orders: number;
  abnormal_orders: number;
  by_community: Array<{
    community_id: string;
    community_name: string;
    order_count: number;
    quantity: number;
    amount_cents: number;
  }>;
  by_product: Array<{
    product_id: string;
    product_name: string;
    quantity: number;
    order_count: number;
  }>;
};
