export type InventoryItem = {
  product_id: string;
  product_name: string;
  stock: number;
  unit: string;
  stock_unit: string;
  sale_unit: string;
  sale_spec_name?: string | null;
  stock_deduct_quantity: number;
  display_stock: string;
  display_sale_spec: string;
  status: string;
  low_stock_threshold: number;
  suggest_purchase_quantity: number;
};

export type InventoryOverview = {
  low_stock_count: number;
  out_of_stock_count: number;
  total_sku_count: number;
  items: InventoryItem[];
};

export type StockLedger = {
  id: string;
  source_type: string;
  direction: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  remark?: string | null;
  created_at: string;
};

export type PurchasePlanItem = {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  planned_quantity: number;
  received_quantity: number;
  purchase_unit?: string | null;
  purchase_quantity?: number | null;
  stock_in_quantity?: number | null;
  cost_price_cents: number;
  subtotal_cents: number;
};

export type PurchasePlan = {
  id: string;
  plan_no: string;
  status: string;
  target_date: string;
  supplier_name?: string | null;
  total_quantity: number;
  total_amount_cents: number;
  items: PurchasePlanItem[];
};

export type Supplier = {
  id: string;
  name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  status: string;
  remark?: string | null;
};

export type ProductBatch = {
  id: string;
  batch_no: string;
  product_id: string;
  product_name_snapshot: string;
  supplier_name_snapshot?: string | null;
  stock_unit: string;
  initial_quantity: number;
  remaining_quantity: number;
  arrival_date: string;
  expire_at?: string | null;
  shelf_life_days?: number | null;
  status: string;
  days_to_expire?: number | null;
  status_hint?: string;
};

export type BatchStockLedger = {
  id: string;
  source_type: string;
  direction: string;
  quantity: number;
  batch_quantity_before: number;
  batch_quantity_after: number;
  product_stock_before?: number | null;
  product_stock_after?: number | null;
  remark?: string | null;
};

export type ExpiryAlert = {
  batch_id: string;
  batch_no: string;
  product_id: string;
  product_name: string;
  supplier_name?: string | null;
  remaining_quantity: number;
  stock_unit: string;
  expire_at?: string | null;
  days_to_expire?: number | null;
  status_hint: string;
};

export type StockCheckItem = {
  id: string;
  product_id: string;
  batch_id?: string | null;
  book_quantity: number;
  actual_quantity: number;
  diff_quantity: number;
  stock_unit: string;
  reason?: string | null;
};

export type StockCheck = {
  id: string;
  check_no: string;
  status: string;
  remark?: string | null;
  created_at: string;
  confirmed_at?: string | null;
  items: StockCheckItem[];
};

export type InventoryProductReference = Pick<
  InventoryItem,
  | 'product_id'
  | 'product_name'
  | 'stock_unit'
  | 'suggest_purchase_quantity'
  | 'stock_deduct_quantity'
>;

export type CreatePurchasePlanInput = {
  target_date: string;
  supplier_name: string;
  remark: string;
  items: Array<{
    product_id: string;
    purchase_quantity: number;
    purchase_unit: string;
    stock_in_quantity: number;
    cost_price_cents: number;
    remark: string;
  }>;
};

export type ReceivePurchasePlanInput = {
  remark: string;
  items: Array<{
    item_id: string;
    received_quantity: number;
  }>;
};

export type CreateSupplierInput = {
  name: string;
  contact_name: string;
  contact_phone: string;
  remark: string;
};

export type BatchLossInput = {
  quantity: number;
  loss_type: string;
  reason: string;
  responsible_type: string;
};

export type CreateStockCheckInput = {
  remark: string;
  items: Array<{
    batch_id?: string;
    product_id?: string;
    actual_quantity: number;
    reason: string;
  }>;
};
