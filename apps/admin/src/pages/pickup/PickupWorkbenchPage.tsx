import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { getAdminScopeSummary } from "../../access/adminAccess";
import {
  getPickupWorkbenchOrderByCode,
  getPickupWorkbenchOrders,
  getPickupWorkbenchSummary,
  PickupWorkbenchApiError,
  verifyPickupWorkbenchOrder,
  type PickupWorkbenchOrder,
  type PickupWorkbenchSummary,
} from "../../api/pickupWorkbench";

const today = () => new Date().toISOString().slice(0, 10);
const PICKUP_CONFLICT_CODES: ReadonlySet<string> = new Set([
  "ADMIN_PICKUP_TYPE_CONFLICT",
  "ADMIN_PICKUP_STATE_CONFLICT",
  "ADMIN_ORDER_VERSION_CONFLICT",
]);

function hasPickupPermission() {
  const raw = window.localStorage.getItem("admin_permissions") ?? window.localStorage.getItem("adminAccessPermissions") ?? "";
  return raw.includes("pickup.verify") || raw.includes("admin.full_access") || raw === "";
}

export function PickupWorkbenchPage() {
  const [date, setDate] = useState(today());
  const [storeId, setStoreId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [summary, setSummary] = useState<PickupWorkbenchSummary | null>(null);
  const [orders, setOrders] = useState<PickupWorkbenchOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<PickupWorkbenchOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const pendingOrderIdsRef = useRef<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const canAccess = useMemo(hasPickupPermission, []);
  const scopeSummary = useMemo(getAdminScopeSummary, []);

  async function loadData() {
    if (!canAccess) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const [nextSummary, nextOrders] = await Promise.all([
        getPickupWorkbenchSummary({ date, pickup_store_id: storeId }),
        getPickupWorkbenchOrders({ date, pickup_store_id: storeId, keyword, page: 1, page_size: 50 }),
      ]);
      setSummary(nextSummary);
      setOrders(nextOrders.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "自提工作台加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function queryByCode() {
    if (!keyword.trim()) {
      await loadData();
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const order = keyword.trim().toUpperCase().startsWith("PICK-") ? await getPickupWorkbenchOrderByCode(keyword.trim()) : null;
      setSelectedOrder(order);
      if (!order) await loadData();
    } catch (error) {
      setSelectedOrder(null);
      setErrorMessage(error instanceof Error ? error.message : "自提码查询失败");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOrder(order: PickupWorkbenchOrder) {
    if (!canVerify(order) || pendingOrderIdsRef.current.has(order.order_id)) {
      return;
    }
    if (!window.confirm("确认核销该订单？")) return;

    pendingOrderIdsRef.current.add(order.order_id);
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await verifyPickupWorkbenchOrder(
        order.order_id,
        order.version,
        crypto.randomUUID(),
        "店员自提工作台核销",
      );
      await loadData();
      if (selectedOrder?.order_id === order.order_id) {
        setSelectedOrder({
          ...order,
          order_status: result.order_status,
          pickup_status: result.order_status,
          version: result.version,
        });
      }
    } catch (error) {
      if (
        error instanceof PickupWorkbenchApiError &&
        PICKUP_CONFLICT_CODES.has(error.code)
      ) {
        setSelectedOrder((current) =>
          current?.order_id === order.order_id ? null : current,
        );
        await loadData();
      }
      setErrorMessage(error instanceof Error ? error.message : "核销失败");
    } finally {
      pendingOrderIdsRef.current.delete(order.order_id);
      setLoading(false);
    }
  }

  function resetFilters() {
    setDate(today());
    setStoreId("");
    setKeyword("");
    setSelectedOrder(null);
  }

  useEffect(() => { void loadData(); }, [canAccess]);

  if (!canAccess) return <Card title="自提工作台"><Typography.Text type="danger">无权限访问</Typography.Text></Card>;

  const columns: ColumnsType<PickupWorkbenchOrder> = [
    { title: "订单号", dataIndex: "order_no" },
    { title: "自提码", dataIndex: "pickup_code" },
    { title: "商品名", dataIndex: "product_name" },
    { title: "数量", dataIndex: "quantity" },
    { title: "收货人", dataIndex: "receiver_name" },
    { title: "receiver_phone_masked", dataIndex: "receiver_phone_masked" },
    { title: "状态", dataIndex: "pickup_status" },
    {
      title: "操作",
      render: (_, row) =>
        verifyDone(row)
          ? "已核销"
          : canVerify(row)
            ? <Button type="primary" onClick={() => verifyOrder(row)}>核销</Button>
            : "不可核销",
    },
  ];

  return <Space direction="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={3}>店员自提工作台</Typography.Title>
    <Card title="当前数据范围"><Typography.Text>{scopeSummary.label}</Typography.Text>{!scopeSummary.hasConfiguredScope ? <Typography.Paragraph type="warning">当前账号未配置自提点/社区范围，请联系管理员。</Typography.Paragraph> : null}</Card>
    {errorMessage ? <Typography.Text type="danger">{errorMessage}</Typography.Text> : null}
    <Space wrap>
      <Card title="今日待自提">{(summary?.pending_count ?? 0) + (summary?.ready_count ?? 0)}</Card>
      <Card title="已核销">{summary?.picked_count ?? 0}</Card>
      <Card title="已完成">{summary?.completed_count ?? 0}</Card>
      <Card title="总件数">{summary?.total_quantity ?? 0}</Card>
    </Space>
    <Card title="查询区">
      <Space wrap>
        <Input placeholder="自提码 / 订单号" value={keyword} onChange={(event: { target: { value: string } }) => setKeyword(event.target.value)} style={{ width: 220 }} />
        <Input type="date" value={date} onChange={(event: { target: { value: string } }) => setDate(event.target.value)} style={{ width: 180 }} />
        <Input placeholder="自提点 ID" value={storeId} onChange={(event: { target: { value: string } }) => setStoreId(event.target.value)} style={{ width: 220 }} />
        <Button type="primary" loading={loading} onClick={queryByCode}>查询</Button>
        <Button onClick={resetFilters}>重置</Button>
      </Space>
    </Card>
    {selectedOrder ? <Card title="自提码查询结果" extra={verifyDone(selectedOrder) ? "已核销" : canVerify(selectedOrder) ? <Button type="primary" onClick={() => verifyOrder(selectedOrder)}>核销</Button> : "不可核销"}>
      <Space direction="vertical">
        <Typography.Text>订单号：{selectedOrder.order_no}</Typography.Text>
        <Typography.Text>商品名：{selectedOrder.product_name}</Typography.Text>
        <Typography.Text>数量：{selectedOrder.quantity}</Typography.Text>
        <Typography.Text>收货人：{selectedOrder.receiver_name}</Typography.Text>
        <Typography.Text>脱敏手机号：{selectedOrder.receiver_phone_masked}</Typography.Text>
        <Typography.Text>自提点：{selectedOrder.pickup_store_name ?? selectedOrder.pickup_store_id}</Typography.Text>
        <Typography.Text>订单状态：{selectedOrder.order_status}</Typography.Text>
      </Space>
    </Card> : null}
    <Card title="待自提列表">
      <Table rowKey="order_id" loading={loading} dataSource={orders} columns={columns} locale={{ emptyText: "暂无待自提订单" }} pagination={{ pageSize: 20 }} />
    </Card>
  </Space>;
}

function canVerify(order: PickupWorkbenchOrder) {
  return order.pickup_type === "store" && order.order_status === "ready";
}

function verifyDone(order: PickupWorkbenchOrder) {
  return order.pickup_status === "picked" || order.pickup_status === "completed";
}
