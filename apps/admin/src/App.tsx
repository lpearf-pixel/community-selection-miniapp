import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Layout,
  Select,
  Space,
  Switch,
  Table,
  Typography,
} from "antd";
import { formatYuan } from "@community-selection/shared";
import { FinanceRefundLedgerPage } from "./pages/finance/FinanceRefundLedgerPage";
import { PickupWorkbenchPage } from "./pages/pickup/PickupWorkbenchPage";
import { DeliveryReservationPage } from "./pages/delivery/DeliveryReservationPage";
import { DeliveryRuleConfigPage } from "./pages/delivery/DeliveryRuleConfigPage";

type CommissionType = "none" | "fixed" | "percent";
type ProductStatus = "draft" | "active" | "inactive";
type ViewKey =
  | "login"
  | "products"
  | "groupBuys"
  | "orders"
  | "fulfillment"
  | "inventory"
  | "purchasePlans"
  | "suppliers"
  | "batches"
  | "expiryAlerts"
  | "stockChecks"
  | "afterSales"
  | "withdrawals"
  | "alerts"
  | "taxRecords"
  | "finance"
  | "refundLedger"
  | "operations"
  | "pickupWorkbench"
  | "deliveryReservation"
  | "deliveryRuleConfig";

const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

type Category = {
  id: string;
  name: string;
};

type Product = {
  id: string;
  name: string;
  category_id: string;
  category?: Category;
  price_cents: number;
  cost_price_cents: number;
  stock: number;
  unit: string;
  stock_unit: string;
  sale_unit: string;
  sale_spec_name?: string | null;
  stock_deduct_quantity: number;
  is_group_enabled: boolean;
  commission_type: CommissionType;
  commission_value: number;
  status: ProductStatus;
};

type GroupBuy = {
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

type Order = {
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

type Withdrawal = {
  id: string;
  leader_user_id: string;
  amount_cents: number;
  status: string;
  tax_mode: string;
  tax_status: string;
  payable_amount_cents: number;
  invoice_status: string;
};

type OpsAlert = {
  id: string;
  alert_type: string;
  alert_level: string;
  status: string;
  order_id?: string | null;
  title: string;
  message: string;
};

type TaxRecord = {
  id: string;
  leader_user_id?: string | null;
  source_type: string;
  source_id: string;
  tax_mode: string;
  tax_status: string;
  amount_cents: number;
};


type FinanceOverview = {
  paid_amount: number; refunded_amount: number; net_sales_amount: number; after_sale_case_count: number; inventory_loss_estimated_amount: number; service_reward_estimated_amount: number; tax_review_pending_count: number; withdrawal_paid_amount: number;
};
type FinanceOrderRow = { order_id: string; order_status: string; paid_amount: number; refunded_amount: number; net_amount: number; after_sale_case_count: number; commission_reward_amount: number; };
type FinanceRewardRow = { reward_id: string; leader_user_id: string; order_id: string; reward_amount: number; reward_status: string; available_at?: string | null; withdrawal_id?: string | null; recalculated_after_refund: boolean; };
type FinanceAfterSaleRow = { after_sale_case_id: string; order_id: string; type: string; status: string; requested_amount: number; approved_amount: number; resolved_amount: number; linked_inventory_loss_id?: string | null; };



type OperationsOverview = { order_count: number; paid_amount: number; refunded_amount: number; net_sales_amount: number; after_sale_rate: number; refund_rate: number; pickup_completed_count: number; inventory_loss_estimated_amount: number; service_reward_amount: number; };
type OperationsTrendRow = { date: string; order_count: number; paid_amount: number; refunded_amount: number; net_sales_amount: number; after_sale_case_count: number; inventory_loss_count: number; pickup_completed_count: number; };
type OperationsProductRow = { product_id: string; product_name: string; category_name: string; order_count: number; quantity_sold: number; paid_amount: number; refunded_amount: number; net_sales_amount: number; after_sale_rate: number; inventory_loss_count: number; };
type OperationsCommunityRow = { community_id: string; community_name: string; order_count: number; paid_amount: number; refunded_amount: number; net_sales_amount: number; pickup_completed_count: number; after_sale_case_count: number; active_group_buy_count: number; };
type OperationsPickupStoreRow = { pickup_store_id: string; pickup_store_name: string; order_count: number; pickup_completed_count: number; pickup_pending_count: number; pickup_completion_rate: number; paid_amount: number; after_sale_case_count: number; };
type OperationsAlertRow = { type: string; severity: string; title: string; description: string; metric_value: number; };

type InventoryItem = {
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

type InventoryOverview = {
  low_stock_count: number;
  out_of_stock_count: number;
  total_sku_count: number;
  items: InventoryItem[];
};

type StockLedger = {
  id: string;
  source_type: string;
  direction: string;
  quantity: number;
  stock_before: number;
  stock_after: number;
  remark?: string | null;
  created_at: string;
};

type PurchasePlanItem = {
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

type PurchasePlan = {
  id: string;
  plan_no: string;
  status: string;
  target_date: string;
  supplier_name?: string | null;
  total_quantity: number;
  total_amount_cents: number;
  items: PurchasePlanItem[];
};

type Supplier = {
  id: string;
  name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  status: string;
  remark?: string | null;
};

type ProductBatch = {
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

type BatchStockLedger = {
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

type AfterSaleCase = {
  id: string;
  order_id: string;
  user_id?: string | null;
  group_buy_id?: string | null;
  product_id?: string | null;
  product?: { name: string } | null;
  order?: { order_no: string; user?: { nickname: string } | null } | null;
  type: string;
  status: string;
  resolution_type?: string | null;
  reason: string;
  description?: string | null;
  requested_refund_cents?: number | null;
  approved_refund_cents?: number | null;
  evidence_image_urls?: string[] | null;
  responsibility?: string | null;
  admin_note?: string | null;
  created_at: string;
};

type ExpiryAlert = {
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

type StockCheckItem = {
  id: string;
  product_id: string;
  batch_id?: string | null;
  book_quantity: number;
  actual_quantity: number;
  diff_quantity: number;
  stock_unit: string;
  reason?: string | null;
};

type StockCheck = {
  id: string;
  check_no: string;
  status: string;
  remark?: string | null;
  created_at: string;
  confirmed_at?: string | null;
  items: StockCheckItem[];
};

type FulfillmentOverview = {
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

type AiContext = {
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

const emptyProduct: Product = {
  id: "",
  name: "",
  category_id: "",
  price_cents: 0,
  cost_price_cents: 0,
  stock: 0,
  unit: "份",
  stock_unit: "piece",
  sale_unit: "份",
  sale_spec_name: null,
  stock_deduct_quantity: 1,
  is_group_enabled: false,
  commission_type: "none",
  commission_value: 0,
  status: "draft",
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${url}`, {
    credentials: "include",
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  const json = await response.json();
  if (!json.success) throw new Error(json.message || "请求失败");
  return json.data as T;
}

export function App() {
  const [view, setView] = useState<ViewKey>("login");
  const [adminSession, setAdminSession] = useState<{
    username: string;
    role: string;
  } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [groupBuys, setGroupBuys] = useState<GroupBuy[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [fulfillmentOverview, setFulfillmentOverview] =
    useState<FulfillmentOverview | null>(null);
  const [inventoryOverview, setInventoryOverview] =
    useState<InventoryOverview | null>(null);
  const [stockLedgers, setStockLedgers] = useState<StockLedger[]>([]);
  const [purchasePlans, setPurchasePlans] = useState<PurchasePlan[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [batchLedgers, setBatchLedgers] = useState<BatchStockLedger[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [stockChecks, setStockChecks] = useState<StockCheck[]>([]);
  const [afterSales, setAfterSales] = useState<AfterSaleCase[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [financeOverview, setFinanceOverview] = useState<FinanceOverview | null>(null);
  const [financeOrders, setFinanceOrders] = useState<FinanceOrderRow[]>([]);
  const [financeRewards, setFinanceRewards] = useState<FinanceRewardRow[]>([]);
  const [financeAfterSales, setFinanceAfterSales] = useState<FinanceAfterSaleRow[]>([]);
  const [operationsOverview, setOperationsOverview] = useState<OperationsOverview | null>(null);
  const [operationsTrends, setOperationsTrends] = useState<OperationsTrendRow[]>([]);
  const [operationsProducts, setOperationsProducts] = useState<OperationsProductRow[]>([]);
  const [operationsCommunities, setOperationsCommunities] = useState<OperationsCommunityRow[]>([]);
  const [operationsPickupStores, setOperationsPickupStores] = useState<OperationsPickupStoreRow[]>([]);
  const [operationsAlerts, setOperationsAlerts] = useState<OperationsAlertRow[]>([]);
  const [selectedOrderContext, setSelectedOrderContext] =
    useState<AiContext | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product>(emptyProduct);
  const [message, setMessage] = useState("");

  function refresh() {
    void Promise.all([
      fetchJson<Category[]>("/api/categories"),
      fetchJson<{ items: Product[] }>("/api/products"),
      fetchJson<GroupBuy[]>("/api/group-buys"),
      fetchJson<Order[]>("/api/orders"),
      fetchJson<FulfillmentOverview>("/api/admin/fulfillment/overview"),
      fetchJson<InventoryOverview>("/api/admin/inventory/overview"),
      fetchJson<PurchasePlan[]>("/api/admin/purchase-plans"),
      fetchJson<Supplier[]>("/api/admin/suppliers"),
      fetchJson<ProductBatch[]>("/api/admin/inventory/batches"),
      fetchJson<{ items: ExpiryAlert[] }>(
        "/api/admin/inventory/expiry-alerts?days=7",
      ),
      fetchJson<StockCheck[]>("/api/admin/stock-checks"),
      fetchJson<AfterSaleCase[]>("/api/admin/after-sales"),
      fetchJson<Withdrawal[]>("/api/admin/withdrawals"),
      fetchJson<OpsAlert[]>("/api/admin/logs/alerts"),
      fetchJson<TaxRecord[]>("/api/admin/tax-records"),
      fetchJson<FinanceOverview>("/api/admin/finance/reconciliation/overview"),
      fetchJson<{ items: FinanceOrderRow[] }>("/api/admin/finance/reconciliation/orders"),
      fetchJson<FinanceRewardRow[]>("/api/admin/finance/reconciliation/rewards"),
      fetchJson<FinanceAfterSaleRow[]>("/api/admin/finance/reconciliation/after-sales"),
      fetchJson<OperationsOverview>("/api/admin/operations/dashboard/overview"),
      fetchJson<OperationsTrendRow[]>("/api/admin/operations/dashboard/trends?days=7"),
      fetchJson<OperationsProductRow[]>("/api/admin/operations/dashboard/products"),
      fetchJson<OperationsCommunityRow[]>("/api/admin/operations/dashboard/communities"),
      fetchJson<OperationsPickupStoreRow[]>("/api/admin/operations/dashboard/pickup-stores"),
      fetchJson<OperationsAlertRow[]>("/api/admin/operations/dashboard/alerts"),
    ])
      .then(
        ([
          categoryData,
          productData,
          groupBuyData,
          orderData,
          fulfillmentData,
          inventoryData,
          purchasePlanData,
          supplierData,
          batchData,
          expiryData,
          stockCheckData,
          afterSaleData,
          withdrawalData,
          alertData,
          taxRecordData,
          financeOverviewData,
          financeOrderData,
          financeRewardData,
          financeAfterSaleData,
          operationsOverviewData,
          operationsTrendData,
          operationsProductData,
          operationsCommunityData,
          operationsPickupStoreData,
          operationsAlertData,
        ]) => {
          setCategories(categoryData);
          setProducts(productData.items);
          setGroupBuys(groupBuyData);
          setOrders(orderData);
          setFulfillmentOverview(fulfillmentData);
          setInventoryOverview(inventoryData);
          setPurchasePlans(purchasePlanData);
          setSuppliers(supplierData);
          setBatches(batchData);
          setExpiryAlerts(expiryData.items);
          setStockChecks(stockCheckData);
          setAfterSales(afterSaleData);
          setWithdrawals(withdrawalData);
          setAlerts(alertData);
          setTaxRecords(taxRecordData);
          setFinanceOverview(financeOverviewData);
          setFinanceOrders(financeOrderData.items);
          setFinanceRewards(financeRewardData);
          setFinanceAfterSales(financeAfterSaleData);
          setOperationsOverview(operationsOverviewData);
          setOperationsTrends(operationsTrendData);
          setOperationsProducts(operationsProductData);
          setOperationsCommunities(operationsCommunityData);
          setOperationsPickupStores(operationsPickupStoreData);
          setOperationsAlerts(operationsAlertData);
        },
      )
      .catch((error: Error) => setMessage(error.message));
  }

  useEffect(() => {
    void fetchJson<{ username: string; role: string }>("/api/admin/auth/me")
      .then((admin) => {
        setAdminSession(admin);
        setView("products");
        refresh();
      })
      .catch(() => setView("login"));
  }, []);

  const categoryOptions = useMemo(
    () =>
      categories.map((category) => ({
        label: category.name,
        value: category.id,
      })),
    [categories],
  );

  async function loginAdmin(values: {
    username: string;
    password: string;
    totp_code?: string;
  }) {
    const result = await fetchJson<{
      admin_user: { username: string; role: string };
    }>("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify(values),
    });
    setAdminSession(result.admin_user);
    setView("products");
    setMessage("后台登录成功");
    refresh();
  }

  async function logoutAdmin() {
    await fetchJson("/api/admin/auth/logout", { method: "POST" });
    setAdminSession(null);
    setView("login");
    setMessage("已退出后台登录");
  }

  function startCreate() {
    setEditingProduct(emptyProduct);
    setMessage("正在新增商品，保存接口将在后续阶段接入。");
  }

  function startEdit(product: Product) {
    setEditingProduct(product);
    setMessage("正在编辑商品，保存接口将在后续阶段接入。");
  }

  function toggleStatus(product: Product) {
    const nextStatus: ProductStatus =
      product.status === "active" ? "inactive" : "active";
    setProducts((items) =>
      items.map((item) =>
        item.id === product.id ? { ...item, status: nextStatus } : item,
      ),
    );
    setMessage("已在页面临时切换上下架状态，持久化接口将在后续阶段接入。");
  }

  async function loadOrderContext(order: Order) {
    const context = await fetchJson<AiContext>(
      `/api/admin/logs/orders/${order.id}/ai-context`,
    );
    setSelectedOrderContext(context);
    setMessage(`已加载订单 ${order.order_no} 全链路详情`);
  }

  async function reviewWithdrawalTax(withdrawal: Withdrawal) {
    await fetchJson(`/api/admin/withdrawals/${withdrawal.id}/tax-review`, {
      method: "POST",
      body: JSON.stringify({
        tax_mode: "none",
        tax_amount_cents: 0,
        tax_rate_basis: "manual",
        invoice_required: false,
        invoice_status: "not_required",
        tax_remark: "财务人工确认",
      }),
    });
    setMessage("提现税务复核已保存");
    refresh();
  }

  async function updateWithdrawal(
    withdrawal: Withdrawal,
    action: "approve" | "reject" | "mark-paid",
  ) {
    await fetchJson(`/api/admin/withdrawals/${withdrawal.id}/${action}`, {
      method: "POST",
      body: JSON.stringify({ reason: "后台人工处理" }),
    });
    setMessage(`提现申请已执行 ${action}`);
    refresh();
  }

  async function updateAlert(alert: OpsAlert, action: "resolve" | "ignore") {
    await fetchJson(`/api/admin/logs/alerts/${alert.id}/${action}`, {
      method: "POST",
      body: JSON.stringify({
        resolved_by: "admin",
        resolution_note: "后台人工处理",
      }),
    });
    setMessage(`告警已${action === "resolve" ? "处理" : "忽略"}`);
    refresh();
  }

  function exportPicking(format: "summary" | "detail") {
    window.location.href = `${apiBaseUrl}/api/admin/orders/export/picking.csv?format=${format}`;
  }

  async function pickupVerify(order: Order) {
    await fetchJson(`/api/admin/orders/${order.id}/pickup-verify`, {
      method: "POST",
      body: JSON.stringify({ admin_remark: "后台核销自提" }),
    });
    setMessage(`订单 ${order.order_no} 已核销自提`);
    refresh();
  }

  async function loadStockLedger(item: InventoryItem) {
    const ledgers = await fetchJson<StockLedger[]>(
      `/api/admin/inventory/ledger?product_id=${item.product_id}`,
    );
    setStockLedgers(ledgers);
    setMessage(`已加载 ${item.product_name} 库存流水`);
  }

  async function adjustInventory(item: InventoryItem) {
    const adjustText = window.prompt(
      `请输入 ${item.product_name} 调整数量（基础库存单位：${item.stock_unit}，可为负数）`,
      "1",
    );
    if (!adjustText) return;
    const reason = window.prompt("请输入库存调整原因", "后台人工调整");
    if (!reason) return;
    await fetchJson(`/api/admin/inventory/products/${item.product_id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ adjust_quantity: Number(adjustText), reason }),
    });
    setMessage("库存调整已保存");
    refresh();
  }

  async function createPurchasePlan(item?: InventoryItem) {
    const target = item ?? inventoryOverview?.items[0];
    if (!target) {
      setMessage("暂无商品可创建采购计划");
      return;
    }
    const purchaseQuantityText = window.prompt(
      "请输入采购数量（例如 3 箱中的 3）",
      "1",
    );
    if (!purchaseQuantityText) return;
    const purchaseUnit = window.prompt(
      "请输入采购单位（例如 箱 / 袋 / 件）",
      "箱",
    );
    if (!purchaseUnit) return;
    const stockInQuantityText = window.prompt(
      `请输入折算后的入库库存数量（基础库存单位：${target.stock_unit}）`,
      String(
        Math.max(
          1,
          target.suggest_purchase_quantity || target.stock_deduct_quantity || 1,
        ),
      ),
    );
    if (!stockInQuantityText) return;
    const costPriceText = window.prompt("请输入每个采购单位成本（分）", "0");
    if (costPriceText === null) return;
    await fetchJson("/api/admin/purchase-plans", {
      method: "POST",
      body: JSON.stringify({
        target_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        supplier_name: "默认供应商",
        remark: "后台创建采购计划：采购数量与入库库存数量分开记录",
        items: [
          {
            product_id: target.product_id,
            purchase_quantity: Number(purchaseQuantityText),
            purchase_unit: purchaseUnit,
            stock_in_quantity: Number(stockInQuantityText),
            cost_price_cents: Number(costPriceText),
            remark: `采购 ${purchaseQuantityText}${purchaseUnit}，入库 ${stockInQuantityText}${target.stock_unit}`,
          },
        ],
      }),
    });
    setMessage("采购计划已创建");
    refresh();
  }

  async function confirmPurchasePlan(plan: PurchasePlan) {
    await fetchJson(`/api/admin/purchase-plans/${plan.id}/confirm`, {
      method: "POST",
    });
    setMessage("采购计划已确认");
    refresh();
  }

  async function cancelPurchasePlan(plan: PurchasePlan) {
    await fetchJson(`/api/admin/purchase-plans/${plan.id}/cancel`, {
      method: "POST",
    });
    setMessage("采购计划已取消");
    refresh();
  }

  async function receivePurchasePlan(plan: PurchasePlan) {
    await fetchJson(`/api/admin/purchase-plans/${plan.id}/receive`, {
      method: "POST",
      body: JSON.stringify({
        remark: "后台采购入库",
        items: plan.items.map((item) => ({
          item_id: item.id,
          received_quantity: Math.max(
            0,
            item.planned_quantity - item.received_quantity,
          ),
        })),
      }),
    });
    setMessage("采购入库已完成");
    refresh();
  }

  async function createSupplier() {
    const name = window.prompt("请输入供应商名称");
    if (!name) return;
    const contactName = window.prompt("请输入联系人", "") ?? "";
    const contactPhone = window.prompt("请输入联系电话", "") ?? "";
    const remark = window.prompt("请输入备注", "") ?? "";
    await fetchJson("/api/admin/suppliers", {
      method: "POST",
      body: JSON.stringify({
        name,
        contact_name: contactName,
        contact_phone: contactPhone,
        remark,
      }),
    });
    setMessage("供应商已创建");
    refresh();
  }

  async function disableSupplier(supplier: Supplier) {
    await fetchJson(`/api/admin/suppliers/${supplier.id}/disable`, {
      method: "POST",
    });
    setMessage("供应商已禁用");
    refresh();
  }

  async function loadBatchLedger(batch: ProductBatch) {
    const ledgers = await fetchJson<BatchStockLedger[]>(
      `/api/admin/inventory/batches/${batch.id}/ledger`,
    );
    setBatchLedgers(ledgers);
    setMessage(`已加载批次 ${batch.batch_no} 流水`);
  }

  async function recordBatchLoss(batch: ProductBatch) {
    const quantityText = window.prompt(
      `请输入损耗数量（${batch.stock_unit}）`,
      "1",
    );
    if (!quantityText) return;
    const lossType = window.prompt(
      "请输入损耗类型：damaged / expired / weight_loss / bad_fruit / manual_loss / other",
      "bad_fruit",
    );
    if (!lossType) return;
    const reason = window.prompt("请输入损耗原因", "坏果损耗");
    if (!reason) return;
    await fetchJson(`/api/admin/inventory/batches/${batch.id}/loss`, {
      method: "POST",
      body: JSON.stringify({
        quantity: Number(quantityText),
        loss_type: lossType,
        reason,
        responsible_type: "supplier",
      }),
    });
    setMessage("损耗已记录");
    refresh();
  }

  async function createStockCheck() {
    const defaultBatchId = batches[0]?.id ?? "";
    const batchId =
      window.prompt(
        "请输入批次 ID（留空则按商品总库存盘点）",
        defaultBatchId,
      ) ?? "";
    const productId = batchId
      ? undefined
      : (window.prompt(
          "请输入商品 ID",
          inventoryOverview?.items[0]?.product_id ?? "",
        ) ?? "");
    if (!batchId && !productId) return;
    const actualText = window.prompt("请输入实际库存数量（基础库存单位）", "0");
    if (actualText === null) return;
    const reason = window.prompt("请输入盘点原因", "后台盘点") ?? "";
    await fetchJson("/api/admin/stock-checks", {
      method: "POST",
      body: JSON.stringify({
        remark: "后台创建盘点",
        items: [
          {
            batch_id: batchId || undefined,
            product_id: productId || undefined,
            actual_quantity: Number(actualText),
            reason,
          },
        ],
      }),
    });
    setMessage("盘点单已创建");
    refresh();
  }

  async function confirmStockCheck(check: StockCheck) {
    await fetchJson(`/api/admin/stock-checks/${check.id}/confirm`, {
      method: "POST",
    });
    setMessage("盘点单已确认");
    refresh();
  }

  async function reviewAfterSale(
    item: AfterSaleCase,
    status: "approved" | "rejected" | "reviewing",
  ) {
    const refundText =
      status === "approved"
        ? window.prompt(
            "请输入审核通过退款金额（分，可留空）",
            String(item.requested_refund_cents ?? 0),
          )
        : null;
    const responsibility =
      status === "approved"
        ? window.prompt(
            "请输入责任方：supplier / platform / leader / customer / unknown",
            item.responsibility ?? "supplier",
          )
        : item.responsibility;
    const adminNote =
      window.prompt(
        "请输入售后审核备注",
        status === "rejected" ? "售后审核拒绝" : "售后审核处理",
      ) ?? "";
    await fetchJson(`/api/admin/after-sales/${item.id}/review`, {
      method: "POST",
      body: JSON.stringify({
        status,
        approved_refund_cents:
          refundText === null ? undefined : Number(refundText),
        resolution_type: status === "approved" ? "partial_refund" : "reject",
        responsibility,
        admin_note: adminNote,
      }),
    });
    setMessage("售后审核已保存");
    refresh();
  }

  async function resolveAfterSale(item: AfterSaleCase) {
    const resolutionType = window.prompt(
      "请输入处理结果：refund / partial_refund / resend / compensation_note / reject / manual_note",
      item.resolution_type ?? "partial_refund",
    );
    if (!resolutionType) return;
    const refundText =
      resolutionType === "refund" || resolutionType === "partial_refund"
        ? window.prompt(
            "请输入确认退款金额（分）",
            String(
              item.approved_refund_cents ?? item.requested_refund_cents ?? 0,
            ),
          )
        : null;
    const adminNote =
      window.prompt("请输入售后解决备注", "售后客服人工处理") ?? "";
    await fetchJson(`/api/admin/after-sales/${item.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        resolution_type: resolutionType,
        approved_refund_cents:
          refundText === null ? undefined : Number(refundText),
        admin_note: adminNote,
      }),
    });
    setMessage("售后处理已完成");
    refresh();
  }

  async function addAfterSaleNote(item: AfterSaleCase) {
    const note = window.prompt("请输入售后备注", "售后客服补充备注");
    if (!note) return;
    await fetchJson(`/api/admin/after-sales/${item.id}/add-note`, {
      method: "POST",
      body: JSON.stringify({ admin_note: note }),
    });
    setMessage("售后备注已追加");
    refresh();
  }

  async function linkAfterSaleLoss(item: AfterSaleCase) {
    const productId = window.prompt(
      "请输入损耗商品 ID",
      item.product_id ?? inventoryOverview?.items[0]?.product_id ?? "",
    );
    if (!productId) return;
    const batchId = window.prompt("请输入批次 ID（可留空）", "") ?? "";
    const quantityText = window.prompt("请输入损耗数量（基础库存单位）", "1");
    if (!quantityText) return;
    const remark = window.prompt("请输入损耗备注", "售后问题关联损耗") ?? "";
    await fetchJson(`/api/admin/after-sales/${item.id}/link-loss`, {
      method: "POST",
      body: JSON.stringify({
        product_id: productId,
        batch_id: batchId || undefined,
        quantity: Number(quantityText),
        reason: `after_sale_${item.type}`,
        remark,
      }),
    });
    setMessage("售后损耗已关联");
    refresh();
  }

  async function cloneGroupBuy(groupBuy: GroupBuy) {
    const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const pickupTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await fetchJson(`/api/admin/group-buys/${groupBuy.id}/clone`, {
      method: "POST",
      body: JSON.stringify({ end_time: endTime, pickup_time: pickupTime }),
    });
    setMessage("已一键再开团");
    refresh();
  }

  async function markOrder(order: Order, nextStatus: string) {
    await fetchJson<Order>(`/api/orders/${order.id}/status`, {
      method: "POST",
      body: JSON.stringify({ next_status: nextStatus }),
    });
    setMessage(`订单 ${order.order_no} 已更新为 ${nextStatus}`);
    refresh();
  }

  return (
    <Layout style={{ minHeight: "100vh", padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {view === "login" ? (
          <Card title="后台登录" style={{ maxWidth: 480 }}>
            <Form layout="vertical" onFinish={loginAdmin}>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true }]}
              >
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true }]}
              >
                <Input type="password" autoComplete="current-password" />
              </Form.Item>
              <Form.Item name="totp_code" label="二次验证码">
                <Input placeholder="已启用二次验证时填写" />
              </Form.Item>
              <Button type="primary" htmlType="submit">
                登录
              </Button>
            </Form>
            {message ? (
              <Typography.Text type="secondary">{message}</Typography.Text>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
            <Typography.Paragraph>
              L4 基础管理：保留 L3
              商品能力，新增团购列表、团购详情入口、订单列表、订单状态流转和分拣单导出入口。
            </Typography.Paragraph>
            <Space>
              <Button onClick={() => setView("products")}>商品管理</Button>
              <Button onClick={() => setView("groupBuys")}>团购管理</Button>
              <Button onClick={() => setView("orders")}>订单管理</Button>
              <Button onClick={() => setView("fulfillment")}>履约看板</Button>
              <Button onClick={() => setView("inventory")}>库存管理</Button>
              <Button onClick={() => setView("purchasePlans")}>采购计划</Button>
              <Button onClick={() => setView("suppliers")}>供应商管理</Button>
              <Button onClick={() => setView("batches")}>批次库存</Button>
              <Button onClick={() => setView("expiryAlerts")}>临期提醒</Button>
              <Button onClick={() => setView("stockChecks")}>库存盘点</Button>
              <Button onClick={() => setView("afterSales")}>售后客服</Button>
              <Button onClick={() => setView("withdrawals")}>提现管理</Button>
              <Button onClick={() => setView("alerts")}>告警中心</Button>
              <Button onClick={() => setView("taxRecords")}>税务记录</Button>
              <Button onClick={() => setView("finance")}>财务对账</Button>
              <Button onClick={() => setView("refundLedger")}>退款台账</Button>
              <Button onClick={() => setView("operations")}>运营看板</Button>
              <Button onClick={() => setView("pickupWorkbench")}>自提工作台</Button>
              <Button onClick={() => setView("deliveryReservation")}>配送预留</Button>
              <Button onClick={() => setView("deliveryRuleConfig")}>管理配送规则</Button>
              <Button onClick={refresh}>刷新</Button>
              <Button onClick={logoutAdmin}>退出登录</Button>
            </Space>
            {adminSession ? (
              <Typography.Text type="secondary">
                当前管理员：{adminSession.username}
              </Typography.Text>
            ) : null}
            {message ? (
              <Typography.Text type="secondary">{message}</Typography.Text>
            ) : null}
          </Card>
        )}


        {view === "operations" ? (
          <>
            <Card title="运营看板">
              <Space wrap>
                <Card title="今日订单数">{operationsOverview?.order_count ?? 0}</Card>
                <Card title="实收金额">¥{formatYuan(operationsOverview?.paid_amount ?? 0)}</Card>
                <Card title="退款金额">¥{formatYuan(operationsOverview?.refunded_amount ?? 0)}</Card>
                <Card title="净销售额">¥{formatYuan(operationsOverview?.net_sales_amount ?? 0)}</Card>
                <Card title="售后率">{((operationsOverview?.after_sale_rate ?? 0) * 100).toFixed(2)}%</Card>
                <Card title="退款率">{((operationsOverview?.refund_rate ?? 0) * 100).toFixed(2)}%</Card>
                <Card title="自提完成数">{operationsOverview?.pickup_completed_count ?? 0}</Card>
                <Card title="库存损耗估算">¥{formatYuan(operationsOverview?.inventory_loss_estimated_amount ?? 0)}</Card>
                <Card title="开团服务奖励金额">¥{formatYuan(operationsOverview?.service_reward_amount ?? 0)}</Card>
              </Space>
              <Space style={{ marginTop: 16 }} wrap>
                <Button href={`${apiBaseUrl}/api/admin/operations/dashboard/export.csv?type=trends`}>导出趋势 CSV</Button>
                <Button href={`${apiBaseUrl}/api/admin/operations/dashboard/export.csv?type=products`}>导出商品排行 CSV</Button>
                <Button href={`${apiBaseUrl}/api/admin/operations/dashboard/export.csv?type=communities`}>导出社区排行 CSV</Button>
                <Button href={`${apiBaseUrl}/api/admin/operations/dashboard/export.csv?type=pickup_stores`}>导出自提点排行 CSV</Button>
                <Button href={`${apiBaseUrl}/api/admin/operations/dashboard/export.csv?type=alerts`}>导出异常提醒 CSV</Button>
              </Space>
            </Card>
            <Card title="近 7 日趋势表"><Table rowKey="date" dataSource={operationsTrends} columns={[{ title: "date", dataIndex: "date" }, { title: "order_count", dataIndex: "order_count" }, { title: "paid_amount", render: (_: unknown, row: OperationsTrendRow) => `¥${formatYuan(row.paid_amount)}` }, { title: "refunded_amount", render: (_: unknown, row: OperationsTrendRow) => `¥${formatYuan(row.refunded_amount)}` }, { title: "net_sales_amount", render: (_: unknown, row: OperationsTrendRow) => `¥${formatYuan(row.net_sales_amount)}` }, { title: "after_sale_case_count", dataIndex: "after_sale_case_count" }, { title: "inventory_loss_count", dataIndex: "inventory_loss_count" }]} /></Card>
            <Card title="商品排行表"><Table rowKey="product_id" dataSource={operationsProducts} columns={[{ title: "商品", dataIndex: "product_name" }, { title: "分类", dataIndex: "category_name" }, { title: "订单数", dataIndex: "order_count" }, { title: "销售数量", dataIndex: "quantity_sold" }, { title: "实收金额", render: (_: unknown, row: OperationsProductRow) => `¥${formatYuan(row.paid_amount)}` }, { title: "退款金额", render: (_: unknown, row: OperationsProductRow) => `¥${formatYuan(row.refunded_amount)}` }, { title: "净销售额", render: (_: unknown, row: OperationsProductRow) => `¥${formatYuan(row.net_sales_amount)}` }, { title: "售后率", render: (_: unknown, row: OperationsProductRow) => `${(row.after_sale_rate * 100).toFixed(2)}%` }, { title: "损耗数", dataIndex: "inventory_loss_count" }]} /></Card>
            <Card title="社区排行表"><Table rowKey="community_id" dataSource={operationsCommunities} columns={[{ title: "社区", dataIndex: "community_name" }, { title: "订单数", dataIndex: "order_count" }, { title: "实收金额", render: (_: unknown, row: OperationsCommunityRow) => `¥${formatYuan(row.paid_amount)}` }, { title: "退款金额", render: (_: unknown, row: OperationsCommunityRow) => `¥${formatYuan(row.refunded_amount)}` }, { title: "净销售额", render: (_: unknown, row: OperationsCommunityRow) => `¥${formatYuan(row.net_sales_amount)}` }, { title: "自提完成数", dataIndex: "pickup_completed_count" }, { title: "售后数", dataIndex: "after_sale_case_count" }]} /></Card>
            <Card title="自提点履约表"><Table rowKey="pickup_store_id" dataSource={operationsPickupStores} columns={[{ title: "自提点", dataIndex: "pickup_store_name" }, { title: "订单数", dataIndex: "order_count" }, { title: "自提完成数", dataIndex: "pickup_completed_count" }, { title: "待自提数", dataIndex: "pickup_pending_count" }, { title: "自提完成率", render: (_: unknown, row: OperationsPickupStoreRow) => `${(row.pickup_completion_rate * 100).toFixed(2)}%` }, { title: "售后数", dataIndex: "after_sale_case_count" }]} /></Card>
            <Card title="异常提醒列表"><Table rowKey="type" dataSource={operationsAlerts} columns={[{ title: "severity", dataIndex: "severity" }, { title: "title", dataIndex: "title" }, { title: "description", dataIndex: "description" }, { title: "metric_value", dataIndex: "metric_value" }]} /></Card>
          </>
        ) : null}

        {view === "refundLedger" ? <FinanceRefundLedgerPage /> : null}
        {view === "pickupWorkbench" ? <PickupWorkbenchPage /> : null}
        {view === "deliveryReservation" ? <DeliveryReservationPage /> : null}
        {view === "deliveryRuleConfig" ? <DeliveryRuleConfigPage /> : null}

        {view === "finance" ? (
          <>
            <Card title="财务对账">
              <Space wrap>
                <Card title="实收金额">¥{formatYuan(financeOverview?.paid_amount ?? 0)}</Card>
                <Card title="退款金额">¥{formatYuan(financeOverview?.refunded_amount ?? 0)}</Card>
                <Card title="净销售额">¥{formatYuan(financeOverview?.net_sales_amount ?? 0)}</Card>
                <Card title="售后单数">{financeOverview?.after_sale_case_count ?? 0}</Card>
                <Card title="库存损耗估算">¥{formatYuan(financeOverview?.inventory_loss_estimated_amount ?? 0)}</Card>
                <Card title="开团服务奖励估算">¥{formatYuan(financeOverview?.service_reward_estimated_amount ?? 0)}</Card>
                <Card title="待税务审核数量">{financeOverview?.tax_review_pending_count ?? 0}</Card>
                <Card title="已打款提现金额">¥{formatYuan(financeOverview?.withdrawal_paid_amount ?? 0)}</Card>
              </Space>
              <Space style={{ marginTop: 16 }}>
                <Button href={`${apiBaseUrl}/api/admin/finance/reconciliation/export.csv?type=orders`}>导出订单对账 CSV</Button>
                <Button href={`${apiBaseUrl}/api/admin/finance/reconciliation/export.csv?type=rewards`}>导出开团服务奖励 CSV</Button>
                <Button href={`${apiBaseUrl}/api/admin/finance/reconciliation/export.csv?type=after_sales`}>导出售后退款 CSV</Button>
              </Space>
            </Card>
            <Card title="订单对账表">
              <Table rowKey="order_id" dataSource={financeOrders} columns={[
                { title: "order id", dataIndex: "order_id" }, { title: "状态", dataIndex: "order_status" },
                { title: "支付金额", render: (_: unknown, row: FinanceOrderRow) => `¥${formatYuan(row.paid_amount)}` },
                { title: "退款金额", render: (_: unknown, row: FinanceOrderRow) => `¥${formatYuan(row.refunded_amount)}` },
                { title: "净额", render: (_: unknown, row: FinanceOrderRow) => `¥${formatYuan(row.net_amount)}` },
                { title: "售后数量", dataIndex: "after_sale_case_count" },
                { title: "开团服务奖励金额", render: (_: unknown, row: FinanceOrderRow) => `¥${formatYuan(row.commission_reward_amount)}` },
              ]} />
            </Card>
            <Card title="开团服务奖励对账表">
              <Table rowKey="reward_id" dataSource={financeRewards} columns={[
                { title: "leader_user_id", dataIndex: "leader_user_id" }, { title: "order_id", dataIndex: "order_id" },
                { title: "reward_amount", render: (_: unknown, row: FinanceRewardRow) => `¥${formatYuan(row.reward_amount)}` },
                { title: "reward_status", dataIndex: "reward_status" }, { title: "available_at", dataIndex: "available_at" },
                { title: "withdrawal_id", dataIndex: "withdrawal_id" }, { title: "recalculated_after_refund", render: (_: unknown, row: FinanceRewardRow) => row.recalculated_after_refund ? "是" : "否" },
              ]} />
            </Card>
            <Card title="售后/退款对账表">
              <Table rowKey="after_sale_case_id" dataSource={financeAfterSales} columns={[
                { title: "after_sale_case_id", dataIndex: "after_sale_case_id" }, { title: "order_id", dataIndex: "order_id" }, { title: "type", dataIndex: "type" }, { title: "status", dataIndex: "status" },
                { title: "requested_amount", render: (_: unknown, row: FinanceAfterSaleRow) => `¥${formatYuan(row.requested_amount)}` }, { title: "approved_amount", render: (_: unknown, row: FinanceAfterSaleRow) => `¥${formatYuan(row.approved_amount)}` },
                { title: "resolved_amount", render: (_: unknown, row: FinanceAfterSaleRow) => `¥${formatYuan(row.resolved_amount)}` }, { title: "linked_inventory_loss_id", dataIndex: "linked_inventory_loss_id" },
              ]} />
            </Card>
          </>
        ) : null}

        {view === "products" ? (
          <>
            <Card
              title="商品列表"
              extra={<Button onClick={startCreate}>新增商品</Button>}
            >
              <Table
                rowKey="id"
                dataSource={products}
                columns={[
                  { title: "商品名称", dataIndex: "name" },
                  {
                    title: "分类",
                    render: (_: unknown, product: Product) =>
                      product.category?.name ?? "-",
                  },
                  {
                    title: "售价",
                    render: (_: unknown, product: Product) =>
                      `¥${formatYuan(product.price_cents)}`,
                  },
                  {
                    title: "库存",
                    render: (_: unknown, product: Product) =>
                      `${product.stock} ${product.stock_unit ?? product.unit}`,
                  },
                  {
                    title: "销售规格",
                    render: (_: unknown, product: Product) =>
                      product.sale_spec_name ?? "-",
                  },
                  {
                    title: "销售单位",
                    render: (_: unknown, product: Product) =>
                      product.sale_unit ?? product.unit,
                  },
                  {
                    title: "每份扣减",
                    render: (_: unknown, product: Product) =>
                      `${product.stock_deduct_quantity ?? 1} ${product.stock_unit ?? product.unit}`,
                  },
                  {
                    title: "支持开团",
                    render: (_: unknown, product: Product) =>
                      product.is_group_enabled ? "是" : "否",
                  },
                  {
                    title: "开团服务奖励",
                    render: (_: unknown, product: Product) =>
                      product.commission_type === "fixed"
                        ? `固定 ¥${formatYuan(product.commission_value)}`
                        : product.commission_type === "percent"
                          ? `${product.commission_value}%`
                          : "无",
                  },
                  { title: "状态", dataIndex: "status" },
                  {
                    title: "操作",
                    render: (_: unknown, product: Product) => (
                      <Space>
                        <Button onClick={() => startEdit(product)}>编辑</Button>
                        <Button onClick={() => toggleStatus(product)}>
                          {product.status === "active" ? "下架" : "上架"}
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>

            <Card title={editingProduct.id ? "编辑商品" : "新增商品"}>
              <Form layout="vertical">
                <Form.Item label="商品名称">
                  <Input
                    value={editingProduct.name}
                    onChange={(event: { target: { value: string } }) =>
                      setEditingProduct({
                        ...editingProduct,
                        name: event.target.value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="分类">
                  <Select
                    value={editingProduct.category_id}
                    options={categoryOptions}
                    onChange={(value: string) =>
                      setEditingProduct({
                        ...editingProduct,
                        category_id: value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="售价（元）">
                  <InputNumber
                    value={editingProduct.price_cents / 100}
                    min={0}
                    onChange={(value: number) =>
                      setEditingProduct({
                        ...editingProduct,
                        price_cents: Math.round((value ?? 0) * 100),
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="库存（基础库存单位数量）">
                  <InputNumber
                    value={editingProduct.stock}
                    min={0}
                    onChange={(value: number) =>
                      setEditingProduct({
                        ...editingProduct,
                        stock: value ?? 0,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="库存基础单位">
                  <Input
                    value={editingProduct.stock_unit}
                    onChange={(event: { target: { value: string } }) =>
                      setEditingProduct({
                        ...editingProduct,
                        stock_unit: event.target.value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="销售单位">
                  <Input
                    value={editingProduct.sale_unit}
                    onChange={(event: { target: { value: string } }) =>
                      setEditingProduct({
                        ...editingProduct,
                        sale_unit: event.target.value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="销售规格">
                  <Input
                    value={editingProduct.sale_spec_name ?? ""}
                    onChange={(event: { target: { value: string } }) =>
                      setEditingProduct({
                        ...editingProduct,
                        sale_spec_name: event.target.value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="每销售单位扣减库存基础单位数量">
                  <InputNumber
                    value={editingProduct.stock_deduct_quantity}
                    min={1}
                    onChange={(value: number) =>
                      setEditingProduct({
                        ...editingProduct,
                        stock_deduct_quantity: value ?? 1,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="支持开团">
                  <Switch
                    checked={editingProduct.is_group_enabled}
                    onChange={(checked: boolean) =>
                      setEditingProduct({
                        ...editingProduct,
                        is_group_enabled: checked,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="开团服务奖励类型">
                  <Select
                    value={editingProduct.commission_type}
                    options={[
                      { label: "无", value: "none" },
                      { label: "固定金额", value: "fixed" },
                      { label: "百分比", value: "percent" },
                    ]}
                    onChange={(value: CommissionType) =>
                      setEditingProduct({
                        ...editingProduct,
                        commission_type: value,
                      })
                    }
                  />
                </Form.Item>
                <Form.Item label="开团服务奖励值（固定金额用元，百分比用整数）">
                  <InputNumber
                    value={
                      editingProduct.commission_type === "fixed"
                        ? editingProduct.commission_value / 100
                        : editingProduct.commission_value
                    }
                    min={0}
                    onChange={(value: number) =>
                      setEditingProduct({
                        ...editingProduct,
                        commission_value:
                          editingProduct.commission_type === "fixed"
                            ? Math.round((value ?? 0) * 100)
                            : (value ?? 0),
                      })
                    }
                  />
                </Form.Item>
                <Button
                  onClick={() =>
                    setMessage(
                      "保存接口将在后续阶段接入，当前仅完成 L3 基础页面。",
                    )
                  }
                >
                  保存
                </Button>
              </Form>
            </Card>
          </>
        ) : null}

        {view === "groupBuys" ? (
          <Card title="团购列表">
            <Table
              rowKey="id"
              dataSource={groupBuys}
              columns={[
                {
                  title: "商品",
                  render: (_: unknown, groupBuy: GroupBuy) =>
                    groupBuy.product?.name ?? "-",
                },
                {
                  title: "社区",
                  render: (_: unknown, groupBuy: GroupBuy) =>
                    groupBuy.community?.name ?? "-",
                },
                {
                  title: "团购价",
                  render: (_: unknown, groupBuy: GroupBuy) =>
                    `¥${formatYuan(groupBuy.price_cents)}`,
                },
                {
                  title: "人数",
                  render: (_: unknown, groupBuy: GroupBuy) =>
                    `${groupBuy.current_people}/${groupBuy.min_people}`,
                },
                {
                  title: "数量",
                  render: (_: unknown, groupBuy: GroupBuy) =>
                    `${groupBuy.current_quantity}/${groupBuy.min_quantity}`,
                },
                { title: "状态", dataIndex: "status" },
                {
                  title: "截止时间",
                  render: (_: unknown, groupBuy: GroupBuy) =>
                    new Date(groupBuy.end_time).toLocaleString(),
                },
                {
                  title: "操作",
                  render: (_: unknown, groupBuy: GroupBuy) => (
                    <Button onClick={() => cloneGroupBuy(groupBuy)}>
                      一键再开团
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "fulfillment" && fulfillmentOverview ? (
          <Card title="履约看板">
            <Typography.Paragraph>
              今日团购：{fulfillmentOverview.today_group_buys}；待备货：
              {fulfillmentOverview.pending_prepare_orders}；待自提：
              {fulfillmentOverview.ready_pickup_orders}；已自提：
              {fulfillmentOverview.picked_orders}；已完成：
              {fulfillmentOverview.completed_orders}；异常：
              {fulfillmentOverview.abnormal_orders}
            </Typography.Paragraph>
            <Typography.Title level={4}>按社区</Typography.Title>
            <Table
              rowKey="community_id"
              dataSource={fulfillmentOverview.by_community}
              pagination={false}
              columns={[
                { title: "社区", dataIndex: "community_name" },
                { title: "订单数", dataIndex: "order_count" },
                { title: "数量", dataIndex: "quantity" },
                {
                  title: "金额",
                  render: (_: unknown, item: { amount_cents: number }) =>
                    `¥${formatYuan(item.amount_cents)}`,
                },
              ]}
            />
            <Typography.Title level={4}>按商品</Typography.Title>
            <Table
              rowKey="product_id"
              dataSource={fulfillmentOverview.by_product}
              pagination={false}
              columns={[
                { title: "商品", dataIndex: "product_name" },
                { title: "数量", dataIndex: "quantity" },
                { title: "订单数", dataIndex: "order_count" },
              ]}
            />
          </Card>
        ) : null}

        {view === "inventory" && inventoryOverview ? (
          <Card
            title="库存管理"
            extra={
              <Button onClick={() => createPurchasePlan()}>
                按首个商品创建采购计划
              </Button>
            }
          >
            <Typography.Paragraph>
              SKU：{inventoryOverview.total_sku_count}；低库存：
              {inventoryOverview.low_stock_count}；缺货：
              {inventoryOverview.out_of_stock_count}
            </Typography.Paragraph>
            <Table
              rowKey="product_id"
              dataSource={inventoryOverview.items}
              columns={[
                { title: "商品名", dataIndex: "product_name" },
                {
                  title: "当前库存",
                  render: (_: unknown, item: InventoryItem) =>
                    item.display_stock,
                },
                {
                  title: "销售规格",
                  render: (_: unknown, item: InventoryItem) =>
                    item.sale_spec_name ?? "-",
                },
                { title: "销售单位", dataIndex: "sale_unit" },
                {
                  title: "每份扣减",
                  render: (_: unknown, item: InventoryItem) =>
                    `${item.stock_deduct_quantity} ${item.stock_unit}`,
                },
                { title: "状态", dataIndex: "status" },
                {
                  title: "低库存阈值",
                  render: (_: unknown, item: InventoryItem) =>
                    `${item.low_stock_threshold} ${item.stock_unit}`,
                },
                {
                  title: "建议采购量",
                  render: (_: unknown, item: InventoryItem) =>
                    `${item.suggest_purchase_quantity} ${item.stock_unit}`,
                },
                {
                  title: "操作",
                  render: (_: unknown, item: InventoryItem) => (
                    <Space>
                      <Button onClick={() => loadStockLedger(item)}>
                        查看流水
                      </Button>
                      <Button onClick={() => adjustInventory(item)}>
                        库存调整
                      </Button>
                      <Button onClick={() => createPurchasePlan(item)}>
                        创建采购计划
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
            {stockLedgers.length ? (
              <Table
                rowKey="id"
                dataSource={stockLedgers}
                pagination={{ pageSize: 5 }}
                columns={[
                  { title: "类型", dataIndex: "source_type" },
                  { title: "方向", dataIndex: "direction" },
                  { title: "数量", dataIndex: "quantity" },
                  { title: "调整前", dataIndex: "stock_before" },
                  { title: "调整后", dataIndex: "stock_after" },
                  { title: "备注", dataIndex: "remark" },
                ]}
              />
            ) : null}
          </Card>
        ) : null}

        {view === "purchasePlans" ? (
          <Card
            title="采购计划"
            extra={
              <Button onClick={() => createPurchasePlan()}>新增采购计划</Button>
            }
          >
            <Table
              rowKey="id"
              dataSource={purchasePlans}
              columns={[
                { title: "计划编号", dataIndex: "plan_no" },
                {
                  title: "目标日期",
                  render: (_: unknown, plan: PurchasePlan) =>
                    new Date(plan.target_date).toLocaleDateString(),
                },
                { title: "供应商", dataIndex: "supplier_name" },
                { title: "状态", dataIndex: "status" },
                { title: "总数量", dataIndex: "total_quantity" },
                {
                  title: "总金额",
                  render: (_: unknown, plan: PurchasePlan) =>
                    `¥${formatYuan(plan.total_amount_cents)}`,
                },
                {
                  title: "明细",
                  render: (_: unknown, plan: PurchasePlan) =>
                    plan.items
                      .map(
                        (item) =>
                          `${item.product_name_snapshot} 采购${item.purchase_quantity ?? "-"}${item.purchase_unit ?? ""} / 入库${item.received_quantity}/${item.planned_quantity}`,
                      )
                      .join("；"),
                },
                {
                  title: "操作",
                  render: (_: unknown, plan: PurchasePlan) => (
                    <Space>
                      <Button onClick={() => confirmPurchasePlan(plan)}>
                        确认
                      </Button>
                      <Button onClick={() => cancelPurchasePlan(plan)}>
                        取消
                      </Button>
                      <Button onClick={() => receivePurchasePlan(plan)}>
                        入库
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "orders" ? (
          <Card
            title="订单列表"
            extra={
              <Space>
                <Button onClick={() => exportPicking("detail")}>
                  导出明细分拣单 CSV
                </Button>
                <Button onClick={() => exportPicking("summary")}>
                  导出汇总分拣单 CSV
                </Button>
              </Space>
            }
          >
            <Table
              rowKey="id"
              dataSource={orders}
              columns={[
                { title: "订单号", dataIndex: "order_no" },
                {
                  title: "商品",
                  render: (_: unknown, order: Order) =>
                    order.group_buy?.product?.name ?? order.product?.name ?? "-",
                },
                {
                  title: "用户",
                  render: (_: unknown, order: Order) =>
                    order.user?.nickname ?? "-",
                },
                {
                  title: "金额",
                  render: (_: unknown, order: Order) =>
                    `¥${formatYuan(order.pay_amount_cents)}`,
                },
                { title: "支付状态", dataIndex: "pay_status" },
                { title: "订单状态", dataIndex: "order_status" },
                { title: "收货人", dataIndex: "receiver_name" },
                {
                  title: "操作",
                  render: (_: unknown, order: Order) => (
                    <Space>
                      <Button onClick={() => loadOrderContext(order)}>
                        详情
                      </Button>
                      <Button onClick={() => markOrder(order, "preparing")}>
                        备货中
                      </Button>
                      <Button onClick={() => markOrder(order, "ready")}>
                        待自提
                      </Button>
                      <Button onClick={() => pickupVerify(order)}>
                        核销自提
                      </Button>
                      <Button onClick={() => markOrder(order, "picked")}>
                        已自提
                      </Button>
                      <Button onClick={() => markOrder(order, "completed")}>
                        完成
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "orders" && selectedOrderContext ? (
          <Card title="订单全链路详情">
            <Typography.Title level={4}>订单基础信息</Typography.Title>
            <Typography.Paragraph>
              订单号：{selectedOrderContext.order.order_no}；状态：
              {selectedOrderContext.order.order_status}；支付状态：
              {selectedOrderContext.order.pay_status}；实付：¥
              {formatYuan(selectedOrderContext.order.pay_amount_cents)}
            </Typography.Paragraph>
            <Typography.Paragraph>
              消费额度抵扣：¥
              {formatYuan(selectedOrderContext.credit_usage?.amount_cents ?? 0)}
              ；来源：
              {selectedOrderContext.credit_usage?.from_reward_conversion
                ? "开团服务奖励转平台消费额度"
                : "-"}
            </Typography.Paragraph>
            <Typography.Title level={4}>
              支付 / 退款 / 开团服务奖励 / 提现或转消费额度信息
            </Typography.Title>
            <Typography.Paragraph>
              支付、退款、开团服务奖励与提现或转消费额度信息通过下方
              BusinessEventLog、OpsAlertLog 与 AI context 汇总展示。
            </Typography.Paragraph>
            <Typography.Title level={4}>
              OrderTimelineLog 时间线
            </Typography.Title>
            <Table
              rowKey="id"
              dataSource={selectedOrderContext.timeline}
              pagination={false}
              columns={[
                { title: "事件", dataIndex: "event_type" },
                { title: "标题", dataIndex: "title" },
                { title: "时间", dataIndex: "created_at" },
              ]}
            />
            <Typography.Title level={4}>BusinessEventLog</Typography.Title>
            <Table
              rowKey="id"
              dataSource={selectedOrderContext.business_events}
              pagination={false}
              columns={[
                { title: "事件", dataIndex: "event_type" },
                { title: "级别", dataIndex: "event_level" },
                { title: "说明", dataIndex: "message" },
              ]}
            />
            <Typography.Title level={4}>OpsAlertLog</Typography.Title>
            <Table
              rowKey="id"
              dataSource={selectedOrderContext.alerts}
              pagination={false}
              columns={[
                { title: "类型", dataIndex: "alert_type" },
                { title: "级别", dataIndex: "alert_level" },
                { title: "状态", dataIndex: "status" },
                { title: "标题", dataIndex: "title" },
              ]}
            />
          </Card>
        ) : null}

        {view === "suppliers" ? (
          <Card
            title="供应商管理"
            extra={<Button onClick={createSupplier}>新增供应商</Button>}
          >
            <Table
              rowKey="id"
              dataSource={suppliers}
              columns={[
                { title: "供应商", dataIndex: "name" },
                { title: "联系人", dataIndex: "contact_name" },
                { title: "电话", dataIndex: "contact_phone" },
                { title: "状态", dataIndex: "status" },
                { title: "备注", dataIndex: "remark" },
                {
                  title: "操作",
                  render: (_: unknown, supplier: Supplier) => (
                    <Button onClick={() => disableSupplier(supplier)}>
                      禁用
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "batches" ? (
          <Card title="批次库存">
            <Table
              rowKey="id"
              dataSource={batches}
              columns={[
                { title: "批次号", dataIndex: "batch_no" },
                { title: "商品", dataIndex: "product_name_snapshot" },
                { title: "供应商", dataIndex: "supplier_name_snapshot" },
                {
                  title: "剩余数量",
                  render: (_: unknown, batch: ProductBatch) =>
                    `${batch.remaining_quantity} ${batch.stock_unit}`,
                },
                {
                  title: "到货日期",
                  render: (_: unknown, batch: ProductBatch) =>
                    new Date(batch.arrival_date).toLocaleDateString(),
                },
                {
                  title: "过期日期",
                  render: (_: unknown, batch: ProductBatch) =>
                    batch.expire_at
                      ? new Date(batch.expire_at).toLocaleDateString()
                      : "-",
                },
                {
                  title: "状态",
                  render: (_: unknown, batch: ProductBatch) =>
                    batch.status_hint ?? batch.status,
                },
                {
                  title: "操作",
                  render: (_: unknown, batch: ProductBatch) => (
                    <Space>
                      <Button onClick={() => recordBatchLoss(batch)}>
                        记录损耗
                      </Button>
                      <Button onClick={() => loadBatchLedger(batch)}>
                        查看批次流水
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
            {batchLedgers.length ? (
              <Table
                rowKey="id"
                dataSource={batchLedgers}
                pagination={{ pageSize: 5 }}
                columns={[
                  { title: "类型", dataIndex: "source_type" },
                  { title: "方向", dataIndex: "direction" },
                  { title: "数量", dataIndex: "quantity" },
                  { title: "批次调整前", dataIndex: "batch_quantity_before" },
                  { title: "批次调整后", dataIndex: "batch_quantity_after" },
                  { title: "备注", dataIndex: "remark" },
                ]}
              />
            ) : null}
          </Card>
        ) : null}

        {view === "expiryAlerts" ? (
          <Card title="临期提醒（7 天）">
            <Table
              rowKey="batch_id"
              dataSource={expiryAlerts}
              columns={[
                { title: "批次号", dataIndex: "batch_no" },
                { title: "商品", dataIndex: "product_name" },
                { title: "供应商", dataIndex: "supplier_name" },
                {
                  title: "剩余数量",
                  render: (_: unknown, item: ExpiryAlert) =>
                    `${item.remaining_quantity} ${item.stock_unit}`,
                },
                {
                  title: "过期日期",
                  render: (_: unknown, item: ExpiryAlert) =>
                    item.expire_at
                      ? new Date(item.expire_at).toLocaleDateString()
                      : "-",
                },
                { title: "剩余天数", dataIndex: "days_to_expire" },
                { title: "提示", dataIndex: "status_hint" },
              ]}
            />
          </Card>
        ) : null}

        {view === "stockChecks" ? (
          <Card
            title="库存盘点"
            extra={<Button onClick={createStockCheck}>新增盘点</Button>}
          >
            <Table
              rowKey="id"
              dataSource={stockChecks}
              columns={[
                { title: "盘点单号", dataIndex: "check_no" },
                { title: "状态", dataIndex: "status" },
                { title: "备注", dataIndex: "remark" },
                {
                  title: "明细",
                  render: (_: unknown, check: StockCheck) =>
                    check.items
                      .map(
                        (item) =>
                          `${item.batch_id ?? item.product_id}: ${item.book_quantity} -> ${item.actual_quantity} (${item.diff_quantity}) ${item.stock_unit}`,
                      )
                      .join("；"),
                },
                {
                  title: "操作",
                  render: (_: unknown, check: StockCheck) => (
                    <Button onClick={() => confirmStockCheck(check)}>
                      确认
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "afterSales" ? (
          <Card title="售后客服">
            <Table
              rowKey="id"
              dataSource={afterSales}
              columns={[
                { title: "售后单", dataIndex: "id" },
                {
                  title: "订单号",
                  render: (_: unknown, item: AfterSaleCase) =>
                    item.order?.order_no ?? item.order_id,
                },
                {
                  title: "用户",
                  render: (_: unknown, item: AfterSaleCase) =>
                    item.order?.user?.nickname ?? item.user_id ?? "-",
                },
                {
                  title: "商品",
                  render: (_: unknown, item: AfterSaleCase) =>
                    item.product?.name ?? item.product_id ?? "-",
                },
                { title: "类型", dataIndex: "type" },
                { title: "状态", dataIndex: "status" },
                {
                  title: "责任方",
                  render: (_: unknown, item: AfterSaleCase) =>
                    item.responsibility ?? "-",
                },
                {
                  title: "申请退款",
                  render: (_: unknown, item: AfterSaleCase) =>
                    `¥${formatYuan(item.requested_refund_cents ?? 0)}`,
                },
                {
                  title: "审核退款",
                  render: (_: unknown, item: AfterSaleCase) =>
                    `¥${formatYuan(item.approved_refund_cents ?? 0)}`,
                },
                { title: "原因", dataIndex: "reason" },
                {
                  title: "证据 URL",
                  render: (_: unknown, item: AfterSaleCase) =>
                    (item.evidence_image_urls ?? []).join("；") || "-",
                },
                {
                  title: "创建时间",
                  render: (_: unknown, item: AfterSaleCase) =>
                    new Date(item.created_at).toLocaleString(),
                },
                {
                  title: "操作",
                  render: (_: unknown, item: AfterSaleCase) => (
                    <Space>
                      <Button onClick={() => reviewAfterSale(item, "approved")}>
                        审核通过
                      </Button>
                      <Button onClick={() => reviewAfterSale(item, "rejected")}>
                        审核拒绝
                      </Button>
                      <Button onClick={() => resolveAfterSale(item)}>
                        解决
                      </Button>
                      <Button onClick={() => addAfterSaleNote(item)}>
                        追加备注
                      </Button>
                      <Button onClick={() => linkAfterSaleLoss(item)}>
                        关联损耗
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "withdrawals" ? (
          <Card title="提现管理">
            <Table
              rowKey="id"
              dataSource={withdrawals}
              columns={[
                { title: "ID", dataIndex: "id" },
                { title: "开团人", dataIndex: "leader_user_id" },
                {
                  title: "税前金额",
                  render: (_: unknown, item: Withdrawal) =>
                    `¥${formatYuan(item.amount_cents)}`,
                },
                { title: "状态", dataIndex: "status" },
                { title: "tax_mode", dataIndex: "tax_mode" },
                { title: "tax_status", dataIndex: "tax_status" },
                {
                  title: "可处理金额",
                  render: (_: unknown, item: Withdrawal) =>
                    `¥${formatYuan(item.payable_amount_cents)}`,
                },
                { title: "invoice_status", dataIndex: "invoice_status" },
                {
                  title: "操作",
                  render: (_: unknown, item: Withdrawal) => (
                    <Space>
                      <Button onClick={() => updateWithdrawal(item, "approve")}>
                        审核通过
                      </Button>
                      <Button onClick={() => updateWithdrawal(item, "reject")}>
                        拒绝
                      </Button>
                      <Button onClick={() => reviewWithdrawalTax(item)}>
                        税务复核
                      </Button>
                      <Button
                        onClick={() => updateWithdrawal(item, "mark-paid")}
                      >
                        标记已处理
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "alerts" ? (
          <Card title="告警中心">
            <Table
              rowKey="id"
              dataSource={alerts}
              columns={[
                { title: "类型", dataIndex: "alert_type" },
                { title: "级别", dataIndex: "alert_level" },
                { title: "状态", dataIndex: "status" },
                { title: "订单", dataIndex: "order_id" },
                { title: "标题", dataIndex: "title" },
                { title: "说明", dataIndex: "message" },
                {
                  title: "操作",
                  render: (_: unknown, item: OpsAlert) => (
                    <Space>
                      <Button onClick={() => updateAlert(item, "resolve")}>
                        resolve
                      </Button>
                      <Button onClick={() => updateAlert(item, "ignore")}>
                        ignore
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}

        {view === "taxRecords" ? (
          <Card title="税务记录">
            <Table
              rowKey="id"
              dataSource={taxRecords}
              columns={[
                { title: "来源类型", dataIndex: "source_type" },
                { title: "来源 ID", dataIndex: "source_id" },
                { title: "开团人", dataIndex: "leader_user_id" },
                { title: "tax_mode", dataIndex: "tax_mode" },
                { title: "tax_status", dataIndex: "tax_status" },
                {
                  title: "金额",
                  render: (_: unknown, item: TaxRecord) =>
                    `¥${formatYuan(item.amount_cents)}`,
                },
              ]}
            />
          </Card>
        ) : null}
      </Space>
    </Layout>
  );
}
