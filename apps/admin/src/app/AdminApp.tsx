import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Layout,
  Space,
  Table,
  Typography,
} from "antd";
import { formatYuan } from "@community-selection/shared";
import { FinanceRefundLedgerPage } from "../pages/finance/FinanceRefundLedgerPage";
import { PickupWorkbenchPage } from "../pages/pickup/PickupWorkbenchPage";
import { DeliveryReservationPage } from "../pages/delivery/DeliveryReservationPage";
import { DeliveryRuleConfigPage } from "../pages/delivery/DeliveryRuleConfigPage";
import { RewardLedgerPage } from "../pages/rewards/RewardLedgerPage";
import { WithdrawalReviewPage } from "../pages/withdrawals/WithdrawalReviewPage";
import { TaxReviewPage } from "../pages/tax-review/TaxReviewPage";
import { AdminBusinessDashboardV2Page } from "../pages/dashboard-v2/AdminBusinessDashboardV2Page";
import { CatalogProductsPage } from "../features/catalog/products/CatalogProductsPage";
import { FinanceReconciliationPage } from "../features/finance/reconciliation/FinanceReconciliationPage";
import { OperationsDashboardPage } from "../features/operations/dashboard/OperationsDashboardPage";
import { GroupBuyManagementPage } from "../features/sales/group-buys/GroupBuyManagementPage";
import { OrdersPage } from "../features/sales/orders/OrdersPage";
import { FulfillmentOverviewPage } from "../features/fulfillment/overview/FulfillmentOverviewPage";
import { AfterSalesPage } from "../features/sales/after-sales/AfterSalesPage";
import { DEFAULT_ADMIN_VIEW, type AdminViewKey } from "./admin-view";
import { AdminErrorBoundary } from "./AdminErrorBoundary";
import { AdminFeatureWorkspace } from "./AdminFeatureWorkspace";
import { AdminShell } from "./AdminShell";
import { adminRefreshTarget } from "./refresh-policy";

const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";

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

export function AdminApp() {
  const [view, setView] = useState<AdminViewKey>("login");
  const [adminSession, setAdminSession] = useState<{
    username: string;
    role: string;
  } | null>(null);
  const [inventoryOverview, setInventoryOverview] =
    useState<InventoryOverview | null>(null);
  const [stockLedgers, setStockLedgers] = useState<StockLedger[]>([]);
  const [purchasePlans, setPurchasePlans] = useState<PurchasePlan[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [batchLedgers, setBatchLedgers] = useState<BatchStockLedger[]>([]);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [stockChecks, setStockChecks] = useState<StockCheck[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [message, setMessage] = useState("");
  const [groupBuysRefreshVersion, setGroupBuysRefreshVersion] = useState(0);
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);
  const [fulfillmentRefreshVersion, setFulfillmentRefreshVersion] = useState(0);
  const [afterSalesRefreshVersion, setAfterSalesRefreshVersion] = useState(0);
  const [catalogRefreshVersion, setCatalogRefreshVersion] = useState(0);
  const [financeRefreshVersion, setFinanceRefreshVersion] = useState(0);
  const [operationsRefreshVersion, setOperationsRefreshVersion] = useState(0);

  function refreshLegacyFeatures() {
    void Promise.all([
      fetchJson<InventoryOverview>("/api/admin/inventory/overview"),
      fetchJson<PurchasePlan[]>("/api/admin/purchase-plans"),
      fetchJson<Supplier[]>("/api/admin/suppliers"),
      fetchJson<ProductBatch[]>("/api/admin/inventory/batches"),
      fetchJson<{ items: ExpiryAlert[] }>(
        "/api/admin/inventory/expiry-alerts?days=7",
      ),
      fetchJson<StockCheck[]>("/api/admin/stock-checks"),
      fetchJson<Withdrawal[]>("/api/admin/withdrawals"),
      fetchJson<OpsAlert[]>("/api/admin/logs/alerts"),
      fetchJson<TaxRecord[]>("/api/admin/tax-records"),
    ])
      .then(
        ([
          inventoryData,
          purchasePlanData,
          supplierData,
          batchData,
          expiryData,
          stockCheckData,
          withdrawalData,
          alertData,
          taxRecordData,
        ]) => {
          setInventoryOverview(inventoryData);
          setPurchasePlans(purchasePlanData);
          setSuppliers(supplierData);
          setBatches(batchData);
          setExpiryAlerts(expiryData.items);
          setStockChecks(stockCheckData);
          setWithdrawals(withdrawalData);
          setAlerts(alertData);
          setTaxRecords(taxRecordData);
        },
      )
      .catch((error: Error) => setMessage(error.message));
  }

  function refreshSalesAndLegacyFeatures() {
    setGroupBuysRefreshVersion((version) => version + 1);
    setOrdersRefreshVersion((version) => version + 1);
    setFulfillmentRefreshVersion((version) => version + 1);
    setAfterSalesRefreshVersion((version) => version + 1);
    refreshLegacyFeatures();
  }

  function refreshActiveFeature() {
    const target = adminRefreshTarget(view);
    if (target === "group-buys") {
      setGroupBuysRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "orders") {
      setOrdersRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "fulfillment") {
      setFulfillmentRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "after-sales") {
      setAfterSalesRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "catalog") {
      setCatalogRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "finance") {
      setFinanceRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "operations") {
      setOperationsRefreshVersion((version) => version + 1);
      return;
    }
    refreshLegacyFeatures();
  }

  useEffect(() => {
    void fetchJson<{ username: string; role: string }>("/api/admin/auth/me")
      .then((admin) => {
        setAdminSession(admin);
        setView(DEFAULT_ADMIN_VIEW);
        refreshLegacyFeatures();
      })
      .catch(() => setView("login"));
  }, []);

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
    setView(DEFAULT_ADMIN_VIEW);
    setMessage("后台登录成功");
    refreshLegacyFeatures();
  }

  async function logoutAdmin() {
    await fetchJson("/api/admin/auth/logout", { method: "POST" });
    setAdminSession(null);
    setView("login");
    setMessage("已退出后台登录");
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
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
  }

  async function confirmPurchasePlan(plan: PurchasePlan) {
    await fetchJson(`/api/admin/purchase-plans/${plan.id}/confirm`, {
      method: "POST",
    });
    setMessage("采购计划已确认");
    refreshSalesAndLegacyFeatures();
  }

  async function cancelPurchasePlan(plan: PurchasePlan) {
    await fetchJson(`/api/admin/purchase-plans/${plan.id}/cancel`, {
      method: "POST",
    });
    setMessage("采购计划已取消");
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
  }

  async function disableSupplier(supplier: Supplier) {
    await fetchJson(`/api/admin/suppliers/${supplier.id}/disable`, {
      method: "POST",
    });
    setMessage("供应商已禁用");
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
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
    refreshSalesAndLegacyFeatures();
  }

  async function confirmStockCheck(check: StockCheck) {
    await fetchJson(`/api/admin/stock-checks/${check.id}/confirm`, {
      method: "POST",
    });
    setMessage("盘点单已确认");
    refreshSalesAndLegacyFeatures();
  }

  if (view === "login" || !adminSession) {
    return (
      <Layout style={{ minHeight: "100vh", padding: 24 }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
        </Space>
      </Layout>
    );
  }

  const renderFeatureContent = () => (
    <>
        {view === "operations" ? (
          <OperationsDashboardPage refreshVersion={operationsRefreshVersion} />
        ) : null}

        {view === "refundLedger" ? <FinanceRefundLedgerPage /> : null}
        {view === "withdrawals" ? <WithdrawalReviewPage /> : null}
        {view === "taxRecords" ? <TaxReviewPage /> : null}
        {view === "dashboardV2" ? <AdminBusinessDashboardV2Page /> : null}
        {view === "rewardLedger" ? <RewardLedgerPage /> : null}
        {view === "pickupWorkbench" ? <PickupWorkbenchPage /> : null}
        {view === "deliveryReservation" ? <DeliveryReservationPage /> : null}
        {view === "deliveryRuleConfig" ? <DeliveryRuleConfigPage /> : null}

        {view === "finance" ? (
          <FinanceReconciliationPage refreshVersion={financeRefreshVersion} />
        ) : null}

        <div hidden={view !== "products"}>
          <CatalogProductsPage refreshVersion={catalogRefreshVersion} />
        </div>

        <div
          hidden={
            view !== "groupBuys" && view !== "failedGroupBuyClosure"
          }
        >
          <AdminErrorBoundary resetKey={String(groupBuysRefreshVersion)}>
            <GroupBuyManagementPage
              refreshVersion={groupBuysRefreshVersion}
              activeView={
                view === "failedGroupBuyClosure"
                  ? "failedGroupBuyClosure"
                  : "groupBuys"
              }
              onMessage={setMessage}
              onMutationCommitted={refreshSalesAndLegacyFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "fulfillment"}>
          <AdminErrorBoundary resetKey={String(fulfillmentRefreshVersion)}>
            <FulfillmentOverviewPage
              refreshVersion={fulfillmentRefreshVersion}
            />
          </AdminErrorBoundary>
        </div>

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

        <div hidden={view !== "orders"}>
          <AdminErrorBoundary resetKey={String(ordersRefreshVersion)}>
            <OrdersPage
              refreshVersion={ordersRefreshVersion}
              onMessage={setMessage}
              onMutationCommitted={refreshSalesAndLegacyFeatures}
            />
          </AdminErrorBoundary>
        </div>

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

        <div hidden={view !== "afterSales"}>
          <AdminErrorBoundary resetKey={String(afterSalesRefreshVersion)}>
            <AfterSalesPage
              refreshVersion={afterSalesRefreshVersion}
              defaultLossProductId={
                inventoryOverview?.items[0]?.product_id ?? ""
              }
              onMessage={setMessage}
              onMutationCommitted={refreshSalesAndLegacyFeatures}
            />
          </AdminErrorBoundary>
        </div>

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

        {false && view === "taxRecords" ? (
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
    </>
  );

  return (
    <AdminShell
      activeView={view}
      admin={adminSession}
      message={message}
      onNavigate={setView}
      onRefresh={refreshActiveFeature}
      onLogout={() => void logoutAdmin()}
    >
      <AdminErrorBoundary resetKey={view}>
        <AdminFeatureWorkspace render={renderFeatureContent} />
      </AdminErrorBoundary>
    </AdminShell>
  );
}
