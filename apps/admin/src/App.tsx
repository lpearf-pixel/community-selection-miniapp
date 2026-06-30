import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Layout, Select, Space, Switch, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';

type CommissionType = 'none' | 'fixed' | 'percent';
type ProductStatus = 'draft' | 'active' | 'inactive';
type ViewKey = 'products' | 'groupBuys' | 'orders' | 'withdrawals' | 'alerts' | 'taxRecords';

const apiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? '';

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

type AiContext = {
  order: Order;
  timeline: Array<{ id: string; event_type: string; title: string; created_at: string }>;
  business_events: Array<{ id: string; event_type: string; event_level: string; message?: string | null }>;
  alerts: OpsAlert[];
  credit_usage?: { used_credit: boolean; amount_cents: number; from_reward_conversion: boolean; tax_status?: string | null };
};

const emptyProduct: Product = {
  id: '',
  name: '',
  category_id: '',
  price_cents: 0,
  cost_price_cents: 0,
  stock: 0,
  unit: '份',
  is_group_enabled: false,
  commission_type: 'none',
  commission_value: 0,
  status: 'draft'
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${url}`, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options
  });
  const json = await response.json();
  if (!json.success) throw new Error(json.message || '请求失败');
  return json.data as T;
}

export function App() {
  const [view, setView] = useState<ViewKey>('products');
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [groupBuys, setGroupBuys] = useState<GroupBuy[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [alerts, setAlerts] = useState<OpsAlert[]>([]);
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([]);
  const [selectedOrderContext, setSelectedOrderContext] = useState<AiContext | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product>(emptyProduct);
  const [message, setMessage] = useState('');

  function refresh() {
    void Promise.all([
      fetchJson<Category[]>('/api/categories'),
      fetchJson<{ items: Product[] }>('/api/products'),
      fetchJson<GroupBuy[]>('/api/group-buys'),
      fetchJson<Order[]>('/api/orders'),
      fetchJson<Withdrawal[]>('/api/admin/withdrawals'),
      fetchJson<OpsAlert[]>('/api/admin/logs/alerts'),
      fetchJson<TaxRecord[]>('/api/admin/tax-records')
    ])
      .then(([categoryData, productData, groupBuyData, orderData, withdrawalData, alertData, taxRecordData]) => {
        setCategories(categoryData);
        setProducts(productData.items);
        setGroupBuys(groupBuyData);
        setOrders(orderData);
        setWithdrawals(withdrawalData);
        setAlerts(alertData);
        setTaxRecords(taxRecordData);
      })
      .catch((error: Error) => setMessage(error.message));
  }

  useEffect(refresh, []);

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ label: category.name, value: category.id })),
    [categories]
  );

  function startCreate() {
    setEditingProduct(emptyProduct);
    setMessage('正在新增商品，保存接口将在后续阶段接入。');
  }

  function startEdit(product: Product) {
    setEditingProduct(product);
    setMessage('正在编辑商品，保存接口将在后续阶段接入。');
  }

  function toggleStatus(product: Product) {
    const nextStatus: ProductStatus = product.status === 'active' ? 'inactive' : 'active';
    setProducts((items) => items.map((item) => (item.id === product.id ? { ...item, status: nextStatus } : item)));
    setMessage('已在页面临时切换上下架状态，持久化接口将在后续阶段接入。');
  }

  async function loadOrderContext(order: Order) {
    const context = await fetchJson<AiContext>(`/api/admin/logs/orders/${order.id}/ai-context`);
    setSelectedOrderContext(context);
    setMessage(`已加载订单 ${order.order_no} 全链路详情`);
  }

  async function reviewWithdrawalTax(withdrawal: Withdrawal) {
    await fetchJson(`/api/admin/withdrawals/${withdrawal.id}/tax-review`, {
      method: 'POST',
      body: JSON.stringify({ tax_mode: 'none', tax_amount_cents: 0, tax_rate_basis: 'manual', invoice_required: false, invoice_status: 'not_required', tax_remark: '财务人工确认' })
    });
    setMessage('提现税务复核已保存');
    refresh();
  }

  async function updateWithdrawal(withdrawal: Withdrawal, action: 'approve' | 'reject' | 'mark-paid') {
    await fetchJson(`/api/admin/withdrawals/${withdrawal.id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ reason: '后台人工处理' })
    });
    setMessage(`提现申请已执行 ${action}`);
    refresh();
  }

  async function updateAlert(alert: OpsAlert, action: 'resolve' | 'ignore') {
    await fetchJson(`/api/admin/logs/alerts/${alert.id}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ resolved_by: 'admin', resolution_note: '后台人工处理' })
    });
    setMessage(`告警已${action === 'resolve' ? '处理' : '忽略'}`);
    refresh();
  }

  async function markOrder(order: Order, nextStatus: string) {
    await fetchJson<Order>(`/api/orders/${order.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ next_status: nextStatus })
    });
    setMessage(`订单 ${order.order_no} 已更新为 ${nextStatus}`);
    refresh();
  }

  return (
    <Layout style={{ minHeight: '100vh', padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card>
          <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
          <Typography.Paragraph>
            L4 基础管理：保留 L3 商品能力，新增团购列表、团购详情入口、订单列表、订单状态流转和分拣单导出入口。
          </Typography.Paragraph>
          <Space>
            <Button onClick={() => setView('products')}>商品管理</Button>
            <Button onClick={() => setView('groupBuys')}>团购管理</Button>
            <Button onClick={() => setView('orders')}>订单管理</Button>
            <Button onClick={() => setView('withdrawals')}>提现管理</Button>
            <Button onClick={() => setView('alerts')}>告警中心</Button>
            <Button onClick={() => setView('taxRecords')}>税务记录</Button>
            <Button onClick={refresh}>刷新</Button>
          </Space>
          {message ? <Typography.Text type="secondary">{message}</Typography.Text> : null}
        </Card>

        {view === 'products' ? (
          <>
            <Card title="商品列表" extra={<Button onClick={startCreate}>新增商品</Button>}>
              <Table
                rowKey="id"
                dataSource={products}
                columns={[
                  { title: '商品名称', dataIndex: 'name' },
                  { title: '分类', render: (_: unknown, product: Product) => product.category?.name ?? '-' },
                  { title: '售价', render: (_: unknown, product: Product) => `¥${formatYuan(product.price_cents)}` },
                  { title: '库存', dataIndex: 'stock' },
                  { title: '单位', dataIndex: 'unit' },
                  { title: '支持开团', render: (_: unknown, product: Product) => (product.is_group_enabled ? '是' : '否') },
                  {
                    title: '开团服务奖励',
                    render: (_: unknown, product: Product) =>
                      product.commission_type === 'fixed'
                        ? `固定 ¥${formatYuan(product.commission_value)}`
                        : product.commission_type === 'percent'
                          ? `${product.commission_value}%`
                          : '无'
                  },
                  { title: '状态', dataIndex: 'status' },
                  {
                    title: '操作',
                    render: (_: unknown, product: Product) => (
                      <Space>
                        <Button onClick={() => startEdit(product)}>编辑</Button>
                        <Button onClick={() => toggleStatus(product)}>{product.status === 'active' ? '下架' : '上架'}</Button>
                      </Space>
                    )
                  }
                ]}
              />
            </Card>

            <Card title={editingProduct.id ? '编辑商品' : '新增商品'}>
              <Form layout="vertical">
                <Form.Item label="商品名称">
                  <Input value={editingProduct.name} onChange={(event: { target: { value: string } }) => setEditingProduct({ ...editingProduct, name: event.target.value })} />
                </Form.Item>
                <Form.Item label="分类">
                  <Select value={editingProduct.category_id} options={categoryOptions} onChange={(value: string) => setEditingProduct({ ...editingProduct, category_id: value })} />
                </Form.Item>
                <Form.Item label="售价（元）">
                  <InputNumber value={editingProduct.price_cents / 100} min={0} onChange={(value: number) => setEditingProduct({ ...editingProduct, price_cents: Math.round((value ?? 0) * 100) })} />
                </Form.Item>
                <Form.Item label="库存">
                  <InputNumber value={editingProduct.stock} min={0} onChange={(value: number) => setEditingProduct({ ...editingProduct, stock: value ?? 0 })} />
                </Form.Item>
                <Form.Item label="支持开团">
                  <Switch checked={editingProduct.is_group_enabled} onChange={(checked: boolean) => setEditingProduct({ ...editingProduct, is_group_enabled: checked })} />
                </Form.Item>
                <Form.Item label="开团服务奖励类型">
                  <Select
                    value={editingProduct.commission_type}
                    options={[
                      { label: '无', value: 'none' },
                      { label: '固定金额', value: 'fixed' },
                      { label: '百分比', value: 'percent' }
                    ]}
                    onChange={(value: CommissionType) => setEditingProduct({ ...editingProduct, commission_type: value })}
                  />
                </Form.Item>
                <Form.Item label="开团服务奖励值（固定金额用元，百分比用整数）">
                  <InputNumber value={editingProduct.commission_type === 'fixed' ? editingProduct.commission_value / 100 : editingProduct.commission_value} min={0} onChange={(value: number) => setEditingProduct({ ...editingProduct, commission_value: editingProduct.commission_type === 'fixed' ? Math.round((value ?? 0) * 100) : value ?? 0 })} />
                </Form.Item>
                <Button onClick={() => setMessage('保存接口将在后续阶段接入，当前仅完成 L3 基础页面。')}>保存</Button>
              </Form>
            </Card>
          </>
        ) : null}

        {view === 'groupBuys' ? (
          <Card title="团购列表">
            <Table
              rowKey="id"
              dataSource={groupBuys}
              columns={[
                { title: '商品', render: (_: unknown, groupBuy: GroupBuy) => groupBuy.product?.name ?? '-' },
                { title: '社区', render: (_: unknown, groupBuy: GroupBuy) => groupBuy.community?.name ?? '-' },
                { title: '团购价', render: (_: unknown, groupBuy: GroupBuy) => `¥${formatYuan(groupBuy.price_cents)}` },
                { title: '人数', render: (_: unknown, groupBuy: GroupBuy) => `${groupBuy.current_people}/${groupBuy.min_people}` },
                { title: '数量', render: (_: unknown, groupBuy: GroupBuy) => `${groupBuy.current_quantity}/${groupBuy.min_quantity}` },
                { title: '状态', dataIndex: 'status' },
                { title: '截止时间', render: (_: unknown, groupBuy: GroupBuy) => new Date(groupBuy.end_time).toLocaleString() }
              ]}
            />
          </Card>
        ) : null}

        {view === 'orders' ? (
          <Card title="订单列表" extra={<Button onClick={() => { window.location.href = `${apiBaseUrl}/api/orders/export/picking.csv`; }}>导出分拣单 CSV</Button>}>
            <Table
              rowKey="id"
              dataSource={orders}
              columns={[
                { title: '订单号', dataIndex: 'order_no' },
                { title: '商品', render: (_: unknown, order: Order) => order.group_buy?.product?.name ?? '-' },
                { title: '用户', render: (_: unknown, order: Order) => order.user?.nickname ?? '-' },
                { title: '金额', render: (_: unknown, order: Order) => `¥${formatYuan(order.pay_amount_cents)}` },
                { title: '支付状态', dataIndex: 'pay_status' },
                { title: '订单状态', dataIndex: 'order_status' },
                { title: '收货人', dataIndex: 'receiver_name' },
                {
                  title: '操作',
                  render: (_: unknown, order: Order) => (
                    <Space>
                      <Button onClick={() => loadOrderContext(order)}>详情</Button>
                      <Button onClick={() => markOrder(order, 'preparing')}>备货中</Button>
                      <Button onClick={() => markOrder(order, 'ready')}>待自提</Button>
                      <Button onClick={() => markOrder(order, 'picked')}>已自提</Button>
                      <Button onClick={() => markOrder(order, 'completed')}>完成</Button>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        ) : null}

        {view === 'orders' && selectedOrderContext ? (
          <Card title="订单全链路详情">
            <Typography.Title level={4}>订单基础信息</Typography.Title>
            <Typography.Paragraph>订单号：{selectedOrderContext.order.order_no}；状态：{selectedOrderContext.order.order_status}；支付状态：{selectedOrderContext.order.pay_status}；实付：¥{formatYuan(selectedOrderContext.order.pay_amount_cents)}</Typography.Paragraph>
            <Typography.Paragraph>消费额度抵扣：¥{formatYuan(selectedOrderContext.credit_usage?.amount_cents ?? 0)}；来源：{selectedOrderContext.credit_usage?.from_reward_conversion ? '开团服务奖励转平台消费额度' : '-'}</Typography.Paragraph>
            <Typography.Title level={4}>支付 / 退款 / 开团服务奖励 / 提现或转消费额度信息</Typography.Title>
            <Typography.Paragraph>支付、退款、开团服务奖励与提现或转消费额度信息通过下方 BusinessEventLog、OpsAlertLog 与 AI context 汇总展示。</Typography.Paragraph>
            <Typography.Title level={4}>OrderTimelineLog 时间线</Typography.Title>
            <Table rowKey="id" dataSource={selectedOrderContext.timeline} pagination={false} columns={[{ title: '事件', dataIndex: 'event_type' }, { title: '标题', dataIndex: 'title' }, { title: '时间', dataIndex: 'created_at' }]} />
            <Typography.Title level={4}>BusinessEventLog</Typography.Title>
            <Table rowKey="id" dataSource={selectedOrderContext.business_events} pagination={false} columns={[{ title: '事件', dataIndex: 'event_type' }, { title: '级别', dataIndex: 'event_level' }, { title: '说明', dataIndex: 'message' }]} />
            <Typography.Title level={4}>OpsAlertLog</Typography.Title>
            <Table rowKey="id" dataSource={selectedOrderContext.alerts} pagination={false} columns={[{ title: '类型', dataIndex: 'alert_type' }, { title: '级别', dataIndex: 'alert_level' }, { title: '状态', dataIndex: 'status' }, { title: '标题', dataIndex: 'title' }]} />
          </Card>
        ) : null}

        {view === 'withdrawals' ? (
          <Card title="提现管理">
            <Table
              rowKey="id"
              dataSource={withdrawals}
              columns={[
                { title: 'ID', dataIndex: 'id' },
                { title: '开团人', dataIndex: 'leader_user_id' },
                { title: '税前金额', render: (_: unknown, item: Withdrawal) => `¥${formatYuan(item.amount_cents)}` },
                { title: '状态', dataIndex: 'status' },
                { title: 'tax_mode', dataIndex: 'tax_mode' },
                { title: 'tax_status', dataIndex: 'tax_status' },
                { title: '可处理金额', render: (_: unknown, item: Withdrawal) => `¥${formatYuan(item.payable_amount_cents)}` },
                { title: 'invoice_status', dataIndex: 'invoice_status' },
                {
                  title: '操作',
                  render: (_: unknown, item: Withdrawal) => (
                    <Space>
                      <Button onClick={() => updateWithdrawal(item, 'approve')}>审核通过</Button>
                      <Button onClick={() => updateWithdrawal(item, 'reject')}>拒绝</Button>
                      <Button onClick={() => reviewWithdrawalTax(item)}>税务复核</Button>
                      <Button onClick={() => updateWithdrawal(item, 'mark-paid')}>标记已处理</Button>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        ) : null}

        {view === 'alerts' ? (
          <Card title="告警中心">
            <Table
              rowKey="id"
              dataSource={alerts}
              columns={[
                { title: '类型', dataIndex: 'alert_type' },
                { title: '级别', dataIndex: 'alert_level' },
                { title: '状态', dataIndex: 'status' },
                { title: '订单', dataIndex: 'order_id' },
                { title: '标题', dataIndex: 'title' },
                { title: '说明', dataIndex: 'message' },
                {
                  title: '操作',
                  render: (_: unknown, item: OpsAlert) => (
                    <Space>
                      <Button onClick={() => updateAlert(item, 'resolve')}>resolve</Button>
                      <Button onClick={() => updateAlert(item, 'ignore')}>ignore</Button>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        ) : null}

        {view === 'taxRecords' ? (
          <Card title="税务记录">
            <Table
              rowKey="id"
              dataSource={taxRecords}
              columns={[
                { title: '来源类型', dataIndex: 'source_type' },
                { title: '来源 ID', dataIndex: 'source_id' },
                { title: '开团人', dataIndex: 'leader_user_id' },
                { title: 'tax_mode', dataIndex: 'tax_mode' },
                { title: 'tax_status', dataIndex: 'tax_status' },
                { title: '金额', render: (_: unknown, item: TaxRecord) => `¥${formatYuan(item.amount_cents)}` }
              ]}
            />
          </Card>
        ) : null}
      </Space>
    </Layout>
  );
}
