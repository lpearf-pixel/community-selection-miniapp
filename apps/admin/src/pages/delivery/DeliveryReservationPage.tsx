import { useEffect, useState } from "react";
import { Button, Card, Form, Input, Select, Space, Table, Typography } from "antd";
import { getAdminScopeSummary } from "../../access/adminAccess";
import { getAdminDeliveryRules, getDeliveryOrders, getDeliveryProviders, reserveDeliveryOrder, updateDeliveryOrderStatus, type DeliveryProviderItem, type DeliveryReservation, type DeliveryRule, type DeliveryStatus } from "../../api/delivery";

const statusOptions: Exclude<DeliveryStatus, "none">[] = ["pending_dispatch", "assigned", "delivering", "delivered", "delivery_failed", "canceled"];

export function DeliveryReservationPage() {
  const [providers, setProviders] = useState<DeliveryProviderItem[]>([]);
  const [items, setItems] = useState<DeliveryReservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [rule, setRule] = useState<DeliveryRule | null>(null);
  const [pickupType, setPickupType] = useState<"delivery" | "store" | "">("delivery");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const scopeSummary = getAdminScopeSummary();

  async function load() {
    setLoading(true);
    setErrorMessage("");
    try {
      const [ruleRow, providerRows, orderRows] = await Promise.all([getAdminDeliveryRules(), getDeliveryProviders(), getDeliveryOrders({ keyword, pickup_type: pickupType || undefined, page_size: 50 })]);
      setRule(ruleRow);
        setProviders(providerRows.items);
      setItems(orderRows.items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "配送预留加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function reserve(row: DeliveryReservation) {
    const provider = (window.prompt("provider: self / manual / dada", row.provider === "dada" ? "dada" : "self") || "self") as any;
    if (provider === "dada") window.alert("达达配送接口已预留，当前不会创建真实配送单。");
    const delivery_mode = provider === "dada" ? "third_party_delivery" : "store_delivery";
    await reserveDeliveryOrder(row.order_id, { provider, delivery_mode, remark: "后台配送预留" });
    setSuccessMessage("配送预留已保存");
    await load();
  }
  async function updateStatus(row: DeliveryReservation) {
    const delivery_status = window.prompt(`delivery_status: ${statusOptions.join(" / ")}`, row.delivery_status === "none" ? "pending_dispatch" : row.delivery_status) as Exclude<DeliveryStatus, "none"> | null;
    if (!delivery_status) return;
    await updateDeliveryOrderStatus(row.order_id, { delivery_status, remark: "后台手工更新配送状态" });
    setSuccessMessage("配送状态已更新");
    await load();
  }

  return <Space direction="vertical" style={{ width: "100%" }}>
    <Card title="配送预留">
      <Card title="当前数据范围"><Typography.Text>{scopeSummary.label}</Typography.Text>{!scopeSummary.hasConfiguredScope ? <Typography.Paragraph type="warning">当前账号未配置自提点/社区范围，请联系管理员。</Typography.Paragraph> : null}</Card>
      <Typography.Paragraph>门店配送/人工配送为 mock；达达接口未启用，达达配送接口已预留，当前不会创建真实配送单。页面仅展示 receiver_phone_masked 与 receiver_address_masked。</Typography.Paragraph>
      <Card title="配送规则" style={{ marginBottom: 16 }}>
        <Typography.Paragraph>配送模式：静态 baseline；规则只读，不做编辑保存。</Typography.Paragraph>
        <Typography.Paragraph>配送费：{rule ? `${rule.base_fee_cents} 分` : "加载中"}</Typography.Paragraph>
        <Typography.Paragraph>配送范围：{rule?.service_radius_text ?? "门店确认"}</Typography.Paragraph>
        <Typography.Paragraph>配送时段：{rule?.available_time_windows.map((item) => `${item.label} ${item.start_time}-${item.end_time}`).join(" / ")}</Typography.Paragraph>
        <Typography.Paragraph>达达接口未启用；{rule?.notice}</Typography.Paragraph>
      </Card>
      {errorMessage ? <Typography.Text type="danger">{errorMessage}</Typography.Text> : null}
      {successMessage ? <Typography.Text type="secondary">{successMessage}</Typography.Text> : null}
      <Space wrap style={{ marginTop: 16 }}>{providers.map((item) => <Card key={item.provider} size="small" title={item.name}><Typography.Text>{item.enabled ? "enabled" : "disabled"}</Typography.Text><Typography.Text>{item.mode}</Typography.Text><Typography.Text>{item.description ?? "mock enabled"}</Typography.Text></Card>)}</Space>
      <Form layout="inline" style={{ marginTop: 16 }} onFinish={load}><Form.Item label="关键词"><Input value={keyword} onChange={(event: { target: { value: string } }) => setKeyword(event.target.value)} placeholder="订单号/收货人" /></Form.Item><Form.Item label="pickup_type"><Select style={{ width: 140 }} value={pickupType} onChange={setPickupType} options={[{ value: "delivery", label: "门店配送" }, { value: "store", label: "到店自提" }, { value: "", label: "全部" }]} /></Form.Item><Button htmlType="submit" loading={loading}>查询</Button></Form>
    </Card>
    <Card title="配送订单列表">
      <Table rowKey="order_id" loading={loading} dataSource={items} columns={[
        { title: "订单号", dataIndex: "order_no" }, { title: "pickup_type", dataIndex: "pickup_type", render: (_: unknown, row: DeliveryReservation) => row.delivery_mode === "store_delivery" ? "门店配送" : "到店自提" }, { title: "收货人", dataIndex: "receiver_name" }, { title: "receiver_phone_masked", dataIndex: "receiver_phone_masked" },
        { title: "自提点", dataIndex: "pickup_store_name" }, { title: "sender_address / 自提点地址", dataIndex: "sender_address" }, { title: "receiver_address_masked", dataIndex: "receiver_address_masked" },
        { title: "delivery_status", dataIndex: "delivery_status" }, { title: "provider", dataIndex: "provider" },
        { title: "操作", render: (_: unknown, row: DeliveryReservation) => <Space><Button disabled={!row.can_create_delivery} onClick={() => reserve(row)}>预留配送</Button><Button onClick={() => updateStatus(row)}>更新状态</Button></Space> }
      ]} />
    </Card>
  </Space>;
}
