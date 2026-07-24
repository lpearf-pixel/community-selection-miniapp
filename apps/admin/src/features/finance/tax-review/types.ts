export type TaxReviewRow = {
  tax_record_id: string;
  withdrawal_id: string;
  client_request_id?: string | null;
  leader_user_id?: string | null;
  leader_nickname: string;
  leader_phone_masked?: string | null;
  gross_amount_cents: number;
  taxable_amount_cents: number;
  tax_amount_cents: number;
  payable_amount_cents: number;
  tax_mode: string;
  tax_status: string;
  tax_rate_basis?: string | null;
  invoice_required: boolean;
  invoice_status: string;
  tax_remark?: string | null;
  reviewed_by_admin_id?: string | null;
  reviewed_at?: string | null;
  withdrawal_status?: string | null;
  community_names: string[];
  created_at: string;
  processed_at?: string | null;
  updated_at: string;
};

export type TaxReviewList = {
  items: TaxReviewRow[];
  total: number;
  page: number;
  page_size: number;
};

export type TaxReviewDetail = TaxReviewRow & {
  commissions: Array<{
    commission_id: string;
    order_no: string;
    community_name: string;
    product_name: string;
    reward_amount_cents: number;
  }>;
  admin_audits: Array<{
    action: string;
    admin_user_id?: string | null;
    created_at: string;
  }>;
  business_events: Array<{
    event_type: string;
    event_level: string;
    created_at: string;
  }>;
};

export type TaxReviewPayload = {
  tax_mode: string;
  taxable_amount_cents: number;
  tax_amount_cents: number;
  tax_rate_basis?: string;
  invoice_status?: string;
  tax_remark?: string;
  client_request_id: string;
  expected_updated_at: string;
};

export type TaxReviewQuery = Record<
  string,
  string | number | boolean | undefined
>;
