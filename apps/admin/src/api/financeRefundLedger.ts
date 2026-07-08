export type FinanceRefundLedgerParams = {
  order_no?: string;
  group_buy_id?: string;
  status?: string;
  refund_method?: string;
  from?: string;
  to?: string;
  community_id?: string;
  pickup_store_id?: string;
  page?: number;
  page_size?: number;
};

export type FinanceRefundLedgerItem = {
  refund_id: string;
  order_no: string;
  group_buy_id?: string | null;
  product_name?: string | null;
  refund_status: string;
  refund_method?: string | null;
  refund_amount_cents: number;
  refund_transaction_id?: string | null;
  out_refund_no?: string | null;
  manual_record_only: boolean;
  receiver_name?: string | null;
  receiver_phone_masked?: string | null;
  reason?: string | null;
  admin_remark?: string | null;
  created_at: string;
  processed_at?: string | null;
};

export type FinanceRefundLedgerData = {
  total: number;
  page: number;
  page_size: number;
  summary: {
    refund_count: number;
    refund_amount_cents: number;
  };
  items: FinanceRefundLedgerItem[];
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

function buildRefundLedgerQuery(params: FinanceRefundLedgerParams): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, String(value));
    }
  });
  return query.toString();
}

export async function getFinanceRefundLedger(
  params: FinanceRefundLedgerParams,
): Promise<FinanceRefundLedgerData> {
  const query = buildRefundLedgerQuery(params);
  const response = await fetch(
    `${apiBaseUrl}/api/admin/finance/refund-ledger${query ? `?${query}` : ""}`,
    { credentials: "include" },
  );
  const json = (await response.json()) as ApiResponse<FinanceRefundLedgerData>;
  if (!json.success) throw new Error(json.message || "退款台账查询失败");
  return json.data;
}

export async function downloadFinanceRefundLedgerCsv(
  params: FinanceRefundLedgerParams,
): Promise<Blob> {
  const query = buildRefundLedgerQuery(params);
  const response = await fetch(
    `${apiBaseUrl}/api/admin/finance/refund-ledger/export.csv${query ? `?${query}` : ""}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("退款台账 CSV 导出失败");
  return response.blob();
}
