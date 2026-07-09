export type DeliveryProvider = 'self' | 'dada' | 'manual';
export type DeliveryStatus = 'none' | 'pending_dispatch' | 'assigned' | 'delivering' | 'delivered' | 'delivery_failed' | 'canceled';
export type DeliveryMode = 'store_pickup' | 'store_delivery' | 'third_party_delivery';

export type DeliveryReservation = {
  order_id: string;
  order_no: string;
  provider: DeliveryProvider;
  delivery_status: DeliveryStatus;
  delivery_mode: DeliveryMode;
  pickup_store_id: string | null;
  pickup_store_name: string | null;
  sender_address: string | null;
  receiver_address_masked: string | null;
  receiver_name: string;
  receiver_phone_masked: string;
  estimated_distance_km: number | null;
  delivery_fee_cents: number | null;
  third_party_provider: 'dada' | null;
  third_party_order_no: string | null;
  can_create_delivery: boolean;
  created_at: string | null;
  updated_at: string | null;
};
