import { useEffect, useState } from "react";
import { Alert, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from "antd";
import { formatYuan } from "@community-selection/shared";
import { getTaxReviewDetail, listTaxReview, submitTaxReview, taxReviewExportUrl, TaxReviewDetail, TaxReviewRow } from "../../api/adminTaxReview";

const notice = "仅供内部人工核对，不构成税务申报结果。";

export function TaxReviewPage() {
  const [rows, setRows] = useState<TaxReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<TaxReviewDetail | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [form] = Form.useForm();

  const params = { ...filters, page, page_size: 20 };
  async function load(nextPage = page, nextFilters = filters) {
    setLoading(true);
    try {
      const data = await listTaxReview({ ...nextFilters, page: nextPage, page_size: 20 });
      setRows(data.items); setTotal(data.total); setPage(data.page);
    } catch (error) { message.error(error instanceof Error ? error.message : "加载失败，可能无 data scope 权限"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(1); }, []);
  async function openDetail(row: TaxReviewRow) {
    try { setDetail(await getTaxReviewDetail(row.tax_record_id)); form.setFieldsValue({ tax_mode: row.tax_mode === "pending_review" ? "none" : row.tax_mode, tax_status: row.tax_status, taxable_amount_cents: row.taxable_amount_cents, tax_amount_cents: row.tax_amount_cents, tax_rate_basis: row.tax_rate_basis, invoice_required: row.invoice_required, invoice_status: row.invoice_status, tax_remark: row.tax_remark, client_request_id: `tax-review-${Date.now()}` }); }
    catch (error) { message.error(error instanceof Error ? error.message : "详情加载失败"); }
  }
  async function submit() {
    if (!detail) return;
    const values = await form.validateFields();
    await submitTaxReview(detail.withdrawal_id, values);
    message.success("人工税务 Review 已保存，系统不会自动报税、不会连接外部税务平台、不会自动发起打款。");
    setDetail(null); await load();
  }

  return <Card title="税务人工 Review 工作台">
    <Alert type="warning" showIcon message="系统不会自动报税。系统不会连接外部税务平台。系统不会自动发起打款。仅供内部人工核对。" description={notice} />
    <Space wrap style={{ margin: "16px 0" }}>
      <Input placeholder="Leader／提现申请编号关键词" onChange={(e) => setFilters((v) => ({ ...v, keyword: e.target.value }))} />
      <Select allowClear placeholder="税务状态" style={{ width: 150 }} onChange={(v) => setFilters((f) => ({ ...f, tax_status: v ?? "" }))} options={["pending","completed","calculated","pending_invoice"].map((v) => ({ value: v, label: v }))} />
      <Select allowClear placeholder="税务模式" style={{ width: 150 }} onChange={(v) => setFilters((f) => ({ ...f, tax_mode: v ?? "" }))} options={["pending_review","none","withheld","invoice"].map((v) => ({ value: v, label: v }))} />
      <Select allowClear placeholder="发票状态" style={{ width: 150 }} onChange={(v) => setFilters((f) => ({ ...f, invoice_status: v ?? "" }))} options={["not_required","pending","verified","rejected"].map((v) => ({ value: v, label: v }))} />
      <DatePicker.RangePicker onChange={(_, s) => setFilters((f) => ({ ...f, from: s[0], to: s[1] }))} />
      <Button type="primary" onClick={() => load(1)}>查询</Button>
      <Button href={taxReviewExportUrl(params)}>导出内部核对 CSV</Button>
    </Space>
    <Table rowKey="tax_record_id" loading={loading} dataSource={rows} pagination={{ current: page, total, pageSize: 20, onChange: (p) => load(p) }} columns={[
      { title: "申请编号", dataIndex: "client_request_id" },
      { title: "Leader", render: (_, r) => `${r.leader_nickname} ${r.leader_phone_masked ?? ""}` },
      { title: "社区", render: (_, r) => r.community_names.join("、") },
      { title: "总金额", render: (_, r) => `¥${formatYuan(r.gross_amount_cents)}` },
      { title: "应税/税额/应付", render: (_, r) => `${r.taxable_amount_cents} / ${r.tax_amount_cents} / ${r.payable_amount_cents} 分` },
      { title: "税务", render: (_, r) => <Space><Tag>{r.tax_mode}</Tag><Tag>{r.tax_status}</Tag><Tag>{r.invoice_status}</Tag></Space> },
      { title: "操作", render: (_, r) => <Button onClick={() => openDetail(r)}>详情 / 人工 Review</Button> },
    ]} />
    <Drawer width={720} open={!!detail} onClose={() => setDetail(null)} title="税务 Review 详情">
      {detail ? <>
        <Alert type="info" message="仅供内部人工核对，不构成税务申报结果。系统不会自动报税，不会连接外部税务平台，不会自动发起打款。" />
        <Typography.Paragraph>关联订单/商品：{detail.commissions.map((c) => `${c.order_no}/${c.product_name}/${c.community_name}/${c.reward_amount_cents}分`).join("；")}</Typography.Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item name="tax_mode" label="税务模式" rules={[{ required: true }]}><Select options={["none","withheld","invoice"].map((v) => ({ value: v, label: v }))} /></Form.Item>
          <Form.Item name="tax_status" label="税务状态"><Input /></Form.Item>
          <Form.Item name="taxable_amount_cents" label="应税金额（分）" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item>
          <Form.Item name="tax_amount_cents" label="人工确认税额（分）" rules={[{ required: true }]}><InputNumber min={0} precision={0} /></Form.Item>
          <Form.Item name="tax_rate_basis" label="人工依据"><Input /></Form.Item>
          <Form.Item name="invoice_status" label="发票状态"><Input /></Form.Item>
          <Form.Item name="tax_remark" label="备注"><Input.TextArea /></Form.Item>
          <Form.Item name="client_request_id" label="幂等键" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
        <Button type="primary" onClick={submit}>保存人工 Review</Button>
      </> : null}
    </Drawer>
  </Card>;
}
