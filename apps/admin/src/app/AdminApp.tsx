import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Layout,
  Space,
  Typography,
} from "antd";
import { FinanceRefundLedgerPage } from "../pages/finance/FinanceRefundLedgerPage";
import { PickupWorkbenchPage } from "../pages/pickup/PickupWorkbenchPage";
import { DeliveryReservationPage } from "../pages/delivery/DeliveryReservationPage";
import { DeliveryRuleConfigPage } from "../pages/delivery/DeliveryRuleConfigPage";
import { RewardLedgerPage } from "../pages/rewards/RewardLedgerPage";
import { AdminBusinessDashboardV2Page } from "../pages/dashboard-v2/AdminBusinessDashboardV2Page";
import { CatalogProductsPage } from "../features/catalog/products/CatalogProductsPage";
import { FinanceReconciliationPage } from "../features/finance/reconciliation/FinanceReconciliationPage";
import { TaxReviewPage } from "../features/finance/tax-review/TaxReviewPage";
import { WithdrawalsPage } from "../features/finance/withdrawals/WithdrawalsPage";
import { OperationsAlertsPage } from "../features/operations/alerts/OperationsAlertsPage";
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
  const [withdrawalsRefreshVersion, setWithdrawalsRefreshVersion] =
    useState(0);
  const [alertsRefreshVersion, setAlertsRefreshVersion] = useState(0);
  const [taxReviewRefreshVersion, setTaxReviewRefreshVersion] = useState(0);

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
    setWithdrawalsRefreshVersion((version) => version + 1);
    setAlertsRefreshVersion((version) => version + 1);
    setTaxReviewRefreshVersion((version) => version + 1);
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
    if (target === "withdrawals") {
      setWithdrawalsRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "alerts") {
      setAlertsRefreshVersion((version) => version + 1);
      return;
    }
    if (target === "tax-review") {
      setTaxReviewRefreshVersion((version) => version + 1);
    }
  }

  useEffect(() => {
    void fetchJson<{ username: string; role: string }>("/api/admin/auth/me")
      .then((admin) => {
        setAdminSession(admin);
        setView(DEFAULT_ADMIN_VIEW);
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
  }

  async function logoutAdmin() {
    await fetchJson("/api/admin/auth/logout", { method: "POST" });
    setAdminSession(null);
    setView("login");
    setMessage("已退出后台登录");
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

        <div hidden={view !== "withdrawals"}>
          <AdminErrorBoundary resetKey={String(withdrawalsRefreshVersion)}>
            <WithdrawalsPage
              refreshVersion={withdrawalsRefreshVersion}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "alerts"}>
          <AdminErrorBoundary resetKey={String(alertsRefreshVersion)}>
            <OperationsAlertsPage
              refreshVersion={alertsRefreshVersion}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>

        <div hidden={view !== "taxRecords"}>
          <AdminErrorBoundary resetKey={String(taxReviewRefreshVersion)}>
            <TaxReviewPage
              refreshVersion={taxReviewRefreshVersion}
              onMessage={setMessage}
              onMutationCommitted={refreshBusinessFeatures}
            />
          </AdminErrorBoundary>
        </div>
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
