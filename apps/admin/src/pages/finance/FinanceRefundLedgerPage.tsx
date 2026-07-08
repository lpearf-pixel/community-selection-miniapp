import { useEffect, useMemo, useState } from "react";
import { Button, Card, Form, Input, Select, Space, Table, Typography, message as antMessage } from "antd";
import { formatYuan } from "@community-selection/shared";
import {
  downloadFinanceRefundLedgerCsv,
  getFinanceRefundLedger,
  type FinanceRefundLedgerData,
  type FinanceRefundLedgerItem,
  type FinanceRefundLedgerParams,
} from "../../api/financeRefundLedger";

const defaultPageSize = 10;

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function buildFileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `refund-ledger-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
}

function normalizeFilters(values: FinanceRefundLedgerParams): FinanceRefundLedgerParams {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== ""),
  ) as FinanceRefundLedgerParams;
}

export function FinanceRefundLedgerPage() {
  const [form] = Form.useForm<FinanceRefundLedgerParams>();
  const [filters, setFilters] = useState<FinanceRefundLedgerParams>({ page: 1, page_size: defaultPageSize });
  const [data, setData] = useState<FinanceRefundLedgerData>({
    total: 0,
    page: 1,
    page_size: defaultPageSize,
    summary: { refund_count: 0, refund_amount_cents: 0 },
    items: [],
  });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load(params: FinanceRefundLedgerParams) {
    setLoading(true);
    try {
      const result = await getFinanceRefundLedger(params);
      setData(result);
    } catch (error) {
      antMessage.error(error instanceof Error ? error.message : "退款台账查询失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filters);
  }, [filters]);

  const tableColumns = useMemo(
    () => [
      { title: "退款 ID", dataIndex: "refund_id" },
      { title: "订单号", dataIndex: "order_no" },
      { title: "团购 ID", dataIndex: "group_buy_id" },
      { title: "商品名称", dataIndex: "product_name" },
      { title: "退款状态", dataIndex: "refund_status" },
      { title: "退款方式", dataIndex: "refund_method" },
      { title: "退款金额", render: (_: unknown, row: FinanceRefundLedgerItem) => `¥${formatYuan(row.refund_amount_cents)}` },
      { title: "退款流水号", dataIndex: "refund_transaction_id" },
      { title: "外部退款单号", dataIndex: "out_refund_no" },
      { title: "是否人工记录", render: (_: unknown, row: FinanceRefundLedgerItem) => (row.manual_record_only ? "是" : "否") },
      { title: "收货人", dataIndex: "receiver_name" },
      { title: "手机号", dataIndex: "receiver_phone_masked" },
      { title: "退款原因", dataIndex: "reason" },
      { title: "管理员备注", dataIndex: "admin_remark" },
      { title: "创建时间", render: (_: unknown, row: FinanceRefundLedgerItem) => formatDateTime(row.created_at) },
      { title: "处理时间", render: (_: unknown, row: FinanceRefundLedgerItem) => formatDateTime(row.processed_at) },
    ],
    [],
  );

  function handleSearch(values: FinanceRefundLedgerParams) {
    setFilters({ ...normalizeFilters(values), page: 1, page_size: data.page_size || defaultPageSize });
  }

  function handleReset() {
    form.resetFields();
    setFilters({ page: 1, page_size: defaultPageSize });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await downloadFinanceRefundLedgerCsv(filters);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildFileName();
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      antMessage.error(error instanceof Error ? error.message : "退款台账 CSV 导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="退款台账" extra={<Button loading={exporting} onClick={handleExport}>导出 CSV</Button>}>
        <Typography.Paragraph type="secondary">
          财务退款对账仅展示人工退款记录和退款状态，不触发自动退款。
        </Typography.Paragraph>
        <Form form={form} layout="inline" onFinish={handleSearch}>
          <Form.Item name="order_no" label="订单号"><Input placeholder="order_no" /></Form.Item>
          <Form.Item name="group_buy_id" label="团购 ID"><Input placeholder="group_buy_id" /></Form.Item>
          <Form.Item name="status" label="退款状态"><Select allowClear style={{ width: 160 }} options={["pending", "manual_recorded", "refunded", "partial_refunded", "failed"].map((value) => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="refund_method" label="退款方式"><Select allowClear style={{ width: 160 }} options={["manual", "wechat_mock", "offline"].map((value) => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="from" label="开始时间"><Input type="datetime-local" /></Form.Item>
          <Form.Item name="to" label="结束时间"><Input type="datetime-local" /></Form.Item>
          <Form.Item name="community_id" label="社区"><Input placeholder="community_id" /></Form.Item>
          <Form.Item name="pickup_store_id" label="自提点"><Input placeholder="pickup_store_id" /></Form.Item>
          <Form.Item><Button type="primary" htmlType="submit" loading={loading}>查询</Button></Form.Item>
          <Form.Item><Button onClick={handleReset}>重置</Button></Form.Item>
        </Form>
      </Card>

      <Space wrap>
        <Card title="退款笔数">{data.summary.refund_count}</Card>
        <Card title="退款总金额">¥{formatYuan(data.summary.refund_amount_cents)}</Card>
      </Space>

      <Card title="财务退款对账记录">
        <Table
          rowKey="refund_id"
          loading={loading}
          dataSource={data.items}
          columns={tableColumns}
          locale={{ emptyText: "暂无退款记录" }}
          pagination={{
            current: data.page,
            pageSize: data.page_size,
            total: data.total,
            showTotal: (total) => `total ${total}`,
            onChange: (page, page_size) => setFilters((current) => ({ ...current, page, page_size })),
          }}
          scroll={{ x: 1800 }}
        />
      </Card>
    </Space>
  );
}
