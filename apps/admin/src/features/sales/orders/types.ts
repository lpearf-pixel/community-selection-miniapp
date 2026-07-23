import type { Order } from '../shared/types';

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
