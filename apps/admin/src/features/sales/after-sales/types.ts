export type AfterSaleCase = {
  id: string;
  order_id: string;
  user_id?: string | null;
  group_buy_id?: string | null;
  product_id?: string | null;
  product?: { name: string } | null;
  order?: {
    order_no: string;
    version: number;
    user?: { nickname: string } | null;
    product_amount_cents?: number | null;
    product_refund_amount_cents?: number;
    delivery_fee_cents?: number;
    delivery_refund_amount_cents?: number;
  } | null;
  type: string;
  status: string;
  resolution_type?: string | null;
  reason: string;
  description?: string | null;
  requested_refund_cents?: number | null;
  requested_product_refund_cents?: number | null;
  requested_delivery_refund_cents?: number | null;
  approved_refund_cents?: number | null;
  approved_product_refund_cents?: number | null;
  approved_delivery_refund_cents?: number | null;
  evidence_image_urls?: string[] | null;
  responsibility?: string | null;
  admin_note?: string | null;
  created_at: string;
};

export type AfterSaleRefundExecutionResult = {
  after_sale_case_id: string;
  order_id: string;
  refund_id: string;
  refund_status: 'success';
  refund_amount_cents: number;
  product_refund_amount_cents: number;
  delivery_refund_amount_cents: number;
  remaining_refundable_amount_cents: number;
  order_status: string;
  version: number;
  execution_mode: 'mock';
};

export type AfterSaleReviewInput = {
  status: 'approved' | 'rejected' | 'reviewing';
  approved_refund_cents?: number;
  approved_product_refund_cents?: number;
  approved_delivery_refund_cents?: number;
  resolution_type: string;
  responsibility?: string | null;
  admin_note: string;
};

export type AfterSaleResolveInput = {
  resolution_type: string;
  approved_refund_cents?: number;
  admin_note: string;
};

export type AfterSaleLossInput = {
  product_id: string;
  batch_id?: string;
  quantity: number;
  reason: string;
  remark: string;
};
