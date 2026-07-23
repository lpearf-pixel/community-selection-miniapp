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
import { InventoryOverviewPage } from "../features/inventory/overview/InventoryOverviewPage";
import { PurchasePlansPage } from "../features/supply/purchase-plans/PurchasePlansPage";
import { SuppliersPage } from "../features/supply/suppliers/SuppliersPage";
import { InventoryBatchesPage } from "../features/inventory/batches/InventoryBatchesPage";
import { ExpiryAlertsPage } from "../features/inventory/expiry-alerts/ExpiryAlertsPage";
import { StockChecksPage } from "../features/inventory/stock-checks/StockChecksPage";
import type { InventoryProductReference } from "../features/inventory/shared/types";
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
  const [
    defaultInventoryProductReference,
    setDefaultInventoryProductReference,
  ] = useState<InventoryProductReference | null>(null);
  const [defaultBatchId, setDefaultBatchId] = useState("");
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [message, setMessage] = useState("");
  const [groupBuysRefreshVersion, setGroupBuysRefreshVersion] = useState(0);
  const [ordersRefreshVersion, setOrdersRefreshVersion] = useState(0);
  const [fulfillmentRefreshVersion, setFulfillmentRefreshVersion] = useState(0);
  const [afterSalesRefreshVersion, setAfterSalesRefreshVersion] = useState(0);
  const [inventoryRefreshVersion, setInventoryRefreshVersion] = useState(0);
  const [purchasePlansRefreshVersion, setPurchasePlansRefreshVersion] =
    useState(0);
  const [suppliersRefreshVersion, setSuppliersRefreshVersion] = useState(0);
  const [batchesRefreshVersion, setBatchesRefreshVersion] = useState(0);
  const [expiryAlertsRefreshVersion, setExpiryAlertsRefreshVersion] =
    useState(0);
  const [stockChecksRefreshVersion, setStockChecksRefreshVersion] =
    useState(0);
  const [catalogRefreshVersion, setCatalogRefreshVersion] = useState(0);
  const [financeRefreshVersion, setFinanceRefreshVersion] = useState(0);
  const [operationsRefreshVersion, setOperationsRefreshVersion] = useState(0);

  function refreshLegacyFeatures() {
    void Promise.all([
      fetchJson<Withdrawal[]>("/api/admin/withdrawals"),
      fetchJson<OpsAlert[]>("/api/admin/logs/alerts"),
      fetchJson<TaxRecord[]>("/api/admin/tax-records"),
    ])
      .then(([withdrawalData, alertData, taxRecordData]) => {
        setWithdrawals(withdrawalData);
        setAlerts(alertData);
        setTaxRecords(taxRecordData);
      })
      .catch((error: Error) => setMessage(error.message));
  }

  function refreshBusinessFeatures() {
    setGroupBuysRefreshVersion((version) => version + 1);
    setOrdersRefreshVersion((version) => version + 1);
    setFulfillmentRefreshVersion((version) => version + 1);
    setAfterSalesRefreshVersion((version) => version + 1);
    setInventoryRefreshVersion((version) => version + 1);
    setPurchasePlansRefreshVersion((version) => version + 1);
    setSuppliersRefreshVersion((version) => version + 1);
    setBatchesRefreshVersion((version) => version + 1);
    setExpiryAlertsRefreshVersion((version) => version + 1);
    setStockChecksRefreshVersion((version) => version + 1);
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
    if (target === "inventory") {
      setInventoryRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "purchase-plans") {
      setPurchasePlansRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "suppliers") {
      setSuppliersRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "batches") {
      setBatchesRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "expiry-alerts") {
      setExpiryAlertsRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "stock-checks") {
      setStockChecksRefreshVersion((version) => version + 1);
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
    refreshBusinessFeatures();
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
    refreshBusinessFeatures();
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
    refreshBusinessFeatures();
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
              onMutationCommitted={refreshBusinessFeatures}
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

        <div hidden={view !== "inventory"}>
          <AdminErrorBoundary resetKey={String(inventoryRefreshVersion)}>
            <InventoryOverviewPage
              refreshVersion={inventoryRefreshVersion}
              onDefaultProductReference={setDefaultInventoryProductReference}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "purchasePlans"}>
          <AdminErrorBoundary resetKey={String(purchasePlansRefreshVersion)}>
            <PurchasePlansPage
              refreshVersion={purchasePlansRefreshVersion}
              defaultProductReference={defaultInventoryProductReference}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "orders"}>
          <AdminErrorBoundary resetKey={String(ordersRefreshVersion)}>
            <OrdersPage
              refreshVersion={ordersRefreshVersion}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "suppliers"}>
          <AdminErrorBoundary resetKey={String(suppliersRefreshVersion)}>
            <SuppliersPage
              refreshVersion={suppliersRefreshVersion}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "batches"}>
          <AdminErrorBoundary resetKey={String(batchesRefreshVersion)}>
            <InventoryBatchesPage
              refreshVersion={batchesRefreshVersion}
              onDefaultBatchId={setDefaultBatchId}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "expiryAlerts"}>
          <AdminErrorBoundary resetKey={String(expiryAlertsRefreshVersion)}>
            <ExpiryAlertsPage refreshVersion={expiryAlertsRefreshVersion} />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "stockChecks"}>
          <AdminErrorBoundary resetKey={String(stockChecksRefreshVersion)}>
            <StockChecksPage
              refreshVersion={stockChecksRefreshVersion}
              defaultBatchId={defaultBatchId}
              defaultProductId={
                defaultInventoryProductReference?.product_id ?? ""
              }
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "afterSales"}>
          <AdminErrorBoundary resetKey={String(afterSalesRefreshVersion)}>
            <AfterSalesPage
              refreshVersion={afterSalesRefreshVersion}
              defaultLossProductId={
                defaultInventoryProductReference?.product_id ?? ""
              }
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
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
