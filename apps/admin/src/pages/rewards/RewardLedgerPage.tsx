import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { formatYuan } from '@community-selection/shared';
import { freezeReward, listAdminRewards, releaseDueRewards, reviewAdminReward, unfreezeReward, type RewardItem } from '../../api/adminRewards';

export function RewardLedgerPage() {
  const [items, setItems] = useState<RewardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<{ status?: string; review_status?: string; leader_user_id?: string; order_no?: string; community_id?: string }>();
  const summary = useMemo(() => items.reduce((acc, item) => { acc.final += item.final_amount_cents; acc.deduct += item.deduct_amount_cents; if (item.status === 'available') acc.available += item.final_amount_cents; if (item.status === 'pending') acc.pending += item.final_amount_cents; return acc; }, { final: 0, deduct: 0, available: 0, pending: 0 }), [items]);
  async function load() { setLoading(true); try { const params = new URLSearchParams(); Object.entries(form.getFieldsValue()).forEach(([key, value]) => { if (value) params.set(key, String(value)); }); const data = await listAdminRewards(params); setItems(data.items); } catch (error) { message.error(error instanceof Error ? error.message : '加载失败'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  async function act(action: () => Promise<unknown>) { await action(); await load(); }
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Card title="开团服务奖励账本" extra={<Button type="primary" onClick={() => void act(releaseDueRewards)}>释放到期奖励</Button>}>
      <Typography.Paragraph>完成后第 3 天可用；配送费不参与奖励，退款扣减仅按商品实际成交金额重算。</Typography.Paragraph>
      <Space wrap><Tag color="blue">待可用 ¥{formatYuan(summary.pending)}</Tag><Tag color="green">已可用 ¥{formatYuan(summary.available)}</Tag><Tag color="red">退款扣减 ¥{formatYuan(summary.deduct)}</Tag><Tag>最终奖励 ¥{formatYuan(summary.final)}</Tag></Space>
    </Card>
    <Card>
      <Form form={form} layout="inline" onFinish={() => void load()}>
        <Form.Item name="status" label="状态"><Select allowClear style={{ width: 130 }} options={[{ value: 'pending', label: '待可用' }, { value: 'available', label: '已可用' }, { value: 'cancelled', label: '已取消' }, { value: 'frozen', label: '已冻结' }]} /></Form.Item>
        <Form.Item name="review_status" label="人工核对"><Select allowClear style={{ width: 150 }} options={[{ value: 'unreviewed', label: '未核对' }, { value: 'verified', label: '已核对' }, { value: 'needs_follow_up', label: '待人工复核' }]} /></Form.Item>
        <Form.Item name="leader_user_id" label="Leader"><Input placeholder="Leader ID" /></Form.Item>
        <Form.Item name="order_no" label="订单号"><Input placeholder="订单号" /></Form.Item>
        <Form.Item name="community_id" label="社区"><Input placeholder="社区 ID" /></Form.Item>
        <Button htmlType="submit">查询</Button>
      </Form>
    </Card>
    <Table rowKey="commission_id" loading={loading} dataSource={items} columns={[
      { title: '订单号', dataIndex: 'order_no' }, { title: 'Leader', dataIndex: 'leader_user_id' }, { title: '社区', dataIndex: 'community_name' },
      { title: '商品金额', render: (_: unknown, r: RewardItem) => `¥${formatYuan(r.product_amount_cents)}` }, { title: '已退商品金额', render: (_: unknown, r: RewardItem) => `¥${formatYuan(r.product_refund_amount_cents)}` },
      { title: '原奖励', render: (_: unknown, r: RewardItem) => `¥${formatYuan(r.estimated_amount_cents)}` }, { title: '退款扣减', render: (_: unknown, r: RewardItem) => `¥${formatYuan(r.deduct_amount_cents)}` }, { title: '最终奖励', render: (_: unknown, r: RewardItem) => `¥${formatYuan(r.final_amount_cents)}` },
      { title: '状态', render: (_: unknown, r: RewardItem) => r.status === 'pending' ? '待可用' : r.status === 'available' ? '已可用' : r.status }, { title: 'T+3 可用时间', dataIndex: 'available_at' }, { title: '账本事件', render: (_: unknown, r: RewardItem) => r.ledger_summary?.ledger_count ?? 0 },
      { title: '人工核对', render: (_: unknown, r: RewardItem) => <Space><Tag color={r.review_status === 'needs_follow_up' ? 'red' : 'default'}>{r.review_status === 'needs_follow_up' ? '待人工复核' : r.review_status}</Tag><Button onClick={() => void act(() => reviewAdminReward(r.commission_id, { review_status: 'verified' }))}>核对</Button></Space> },
      { title: '操作', render: (_: unknown, r: RewardItem) => <Space><Button onClick={() => void act(() => freezeReward(r.commission_id))}>冻结</Button><Button onClick={() => void act(() => unfreezeReward(r.commission_id))}>解冻</Button></Space> }
    ]} />
  </Space>;
}
