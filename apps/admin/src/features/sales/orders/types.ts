import type { PaginatedData } from '@community-selection/shared';
import type { Order } from '../shared/types';

export type AdminOrderPayStatus =
  | 'unpaid'
  | 'paid'
  | 'failed'
  | 'closed';
export type AdminOrderStatus =
  | 'unpaid'
  | 'paid'
  | 'grouped'
  | 'preparing'
  | 'ready'
  | 'picked'
  | 'delivered'
  | 'completed'
  | 'refunding'
  | 'refunded'
  | 'closed';
export type AdminOrderRefundStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'processing'
  | 'success'
  | 'failed'
  | 'rejected';

export type AdminOrderListQuery = {
  keyword?: string;
  order_type?: 'normal' | 'group_buy';
  pickup_type?: 'store' | 'delivery';
  pay_status?: AdminOrderPayStatus;
  order_status?: AdminOrderStatus;
  refund_status?: AdminOrderRefundStatus;
  page: number;
  page_size: number;
};

export type AdminOrderListItem = {
  id: string;
  order_no: string;
  order_type: 'normal' | 'group_buy';
  channel: {
    code: 'wechat_miniapp';
    label: '微信小程序';
    source: 'historical_default';
  };
  user: {
    id: string;
    nickname: string;
  };
  product: {
    product_id: string;
    name: string;
    cover_image?: string | null;
    price_cents: number;
    sale_unit: string;
    sale_spec_name?: string | null;
  } | null;
  quantity: number;
  total_amount_cents: number;
  pay_amount_cents: number;
  refund_amount_cents: number;
  pay_status: AdminOrderPayStatus;
  order_status: AdminOrderStatus;
  version: number;
  refund_status: AdminOrderRefundStatus;
  pickup_type: 'store' | 'delivery';
  pickup_store: {
    pickup_store_id: string;
    name: string;
    address: string;
  } | null;
  community: {
    community_id: string;
    name: string;
  } | null;
  receiver_name: string;
  receiver_phone_masked: string | null;
  receiver_address_masked: string | null;
  created_at: string;
  paid_at: string | null;
};

export type AdminOrderListResponse =
  PaginatedData<AdminOrderListItem>;

export type AdminOrderStatusResult = {
  order_id: string;
  order_no: string;
  order_status:
    | 'preparing'
    | 'ready'
    | 'delivered'
    | 'completed';
  version: number;
  completed_at: string | null;
};

export type AdminPickupVerificationResult = {
  order_id: string;
  order_no: string;
  order_status: 'picked';
  version: number;
};

export type OpsAlert = {
  id: string;
  alert_type: string;
  alert_level: string;
  status: string;
  order_id?: string | null;
  title: string;
  message: string;
};

export type AiContext = {
  order: Order;
  timeline: Array<{
    id: string;
    event_type: string;
    title: string;
    created_at: string;
  }>;
  business_events: Array<{
    id: string;
    event_type: string;
    event_level: string;
    message?: string | null;
  }>;
  alerts: OpsAlert[];
  credit_usage?: {
    used_credit: boolean;
    amount_cents: number;
    from_reward_conversion: boolean;
    tax_status?: string | null;
  };
};
