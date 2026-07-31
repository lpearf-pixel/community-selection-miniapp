export type DeliveryProvider = 'self' | 'dada' | 'manual';
export type PersistedDeliveryStatus =
  | 'pending_dispatch'
  | 'delivering'
  | 'delivered'
  | 'exception';
export type DeliveryStatus =
  | 'none'
  | PersistedDeliveryStatus
  | 'assigned'
  | 'delivery_failed'
  | 'canceled';
export type DeliveryMode = 'store_pickup' | 'store_delivery' | 'third_party_delivery';

export type DeliveryReservation = {
  order_id: string;
  order_no: string;
  provider: DeliveryProvider;
  delivery_status: 'none' | PersistedDeliveryStatus;
  version: number;
  allowed_next_statuses: PersistedDeliveryStatus[];
  delivery_mode: DeliveryMode;
  pickup_store_id: string | null;
  pickup_store_name: string | null;
  sender_address: string | null;
  receiver_address_masked: string | null;
  receiver_name: string;
  receiver_phone_masked: string;
  estimated_distance_km: number | null;
  product_amount_cents?: number;
  delivery_fee_cents: number | null;
  pay_amount_cents?: number;
  delivery_time_window_text?: string | null;
  fulfillment_promise_snapshot?: unknown;
  promised_fulfillment_start_at?: string | null;
  promised_fulfillment_end_at?: string | null;
  third_party_provider: 'dada' | null;
  third_party_order_no: string | null;
  can_create_delivery: boolean;
  created_at: string | null;
  updated_at: string | null;
};
