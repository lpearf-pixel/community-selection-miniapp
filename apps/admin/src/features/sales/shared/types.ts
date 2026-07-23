import type { Product } from '../../catalog/products/types';

export type GroupBuy = {
  id: string;
  product?: Product;
  community?: { name: string };
  min_people: number;
  min_quantity: number;
  current_people: number;
  current_quantity: number;
  price_cents: number;
  status: string;
  end_time: string;
  pickup_time: string;
};

export type Order = {
  id: string;
  order_no: string;
  group_buy?: GroupBuy;
  product?: Product;
  user?: { nickname: string };
  pay_amount_cents: number;
  pay_status: string;
  order_status: string;
  receiver_name: string;
  receiver_phone: string;
  credit_amount_cents?: number;
  credit_source_type?: string | null;
};
