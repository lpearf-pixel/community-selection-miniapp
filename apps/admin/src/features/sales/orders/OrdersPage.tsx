import { useEffect, useReducer, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { formatYuan } from '@community-selection/shared';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from '../../../shared/state/feature-resource';
import {
  getPickingExportUrl,
  loadOrderAiContext,
  loadOrders,
  updateOrderStatus,
  verifyOrderPickup,
} from './api';
import {
  applyOrderFilters,
  changeOrderPage,
  DEFAULT_ADMIN_ORDER_QUERY,
} from './page-model';
import type { AdminOrderFilters } from './page-model';
import type {
  AdminOrderListItem,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AiContext,
} from './types';

export type OrdersPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

const orderTypeOptions = [
  { label: '普通购买', value: 'normal' },
  { label: '团购订单', value: 'group_buy' },
];
const pickupTypeOptions = [
  { label: '到店自提', value: 'store' },
  { label: '配送到家', value: 'delivery' },
];
const payStatusOptions = [
  { label: '未支付', value: 'unpaid' },
  { label: '已支付', value: 'paid' },
  { label: '支付失败', value: 'failed' },
  { label: '已关闭', value: 'closed' },
];
const orderStatusOptions = [
  { label: '未支付', value: 'unpaid' },
  { label: '已支付', value: 'paid' },
  { label: '已成团', value: 'grouped' },
  { label: '备货中', value: 'preparing' },
  { label: '待自提', value: 'ready' },
  { label: '已自提', value: 'picked' },
  { label: '已配送', value: 'delivered' },
  { label: '已完成', value: 'completed' },
  { label: '退款中', value: 'refunding' },
  { label: '已退款', value: 'refunded' },
  { label: '已关闭', value: 'closed' },
];
const refundStatusOptions = [
  { label: '无退款', value: 'none' },
  { label: '待处理', value: 'pending' },
  { label: '已批准', value: 'approved' },
  { label: '处理中', value: 'processing' },
  { label: '退款成功', value: 'success' },
  { label: '退款失败', value: 'failed' },
  { label: '已拒绝', value: 'rejected' },
];

function orderTypeLabel(order: AdminOrderListItem): string {
  return order.order_type === 'group_buy' ? '团购订单' : '普通购买';
}

function pickupTypeLabel(order: AdminOrderListItem): string {
  return order.pickup_type === 'delivery' ? '配送到家' : '到店自提';
}

export function OrdersPage(props: OrdersPageProps) {
  const [form] = Form.useForm<AdminOrderFilters>();
  const [query, setQuery] = useState<AdminOrderListQuery>(
    DEFAULT_ADMIN_ORDER_QUERY,
  );
  const [retryVersion, setRetryVersion] = useState(0);
  const [selectedOrderContext, setSelectedOrderContext] =
    useState<AiContext | null>(null);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<AdminOrderListResponse>,
    initialFeatureResourceState<AdminOrderListResponse>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'started' });
    void loadOrders(query, undefined, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'resolved', data });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          dispatch({
            type: 'rejected',
            message: featureErrorMessage(error),
          });
        }
      },
    );
    return () => controller.abort();
  }, [props.refreshVersion, query, retryVersion]);

  const loadOrderContext = async (order: AdminOrderListItem) => {
    const context = await loadOrderAiContext(order.id);
    setSelectedOrderContext(context);
    props.onMessage(`已加载订单 ${order.order_no} 全链路详情`);
  };

  const exportPicking = (format: 'summary' | 'detail') => {
    window.location.href = getPickingExportUrl(format);
  };

  const pickupVerify = async (order: AdminOrderListItem) => {
    await verifyOrderPickup(order.id, '后台核销自提');
    props.onMessage(`订单 ${order.order_no} 已核销自提`);
    props.onMutationCommitted();
  };

  const markOrder = async (
    order: AdminOrderListItem,
    nextStatus: string,
  ) => {
    await updateOrderStatus(order.id, nextStatus);
    props.onMessage(`订单 ${order.order_no} 已更新为 ${nextStatus}`);
    props.onMutationCommitted();
  };

  const applyFilters = (filters: AdminOrderFilters) => {
    setQuery((current) => applyOrderFilters(current, filters));
  };

  const resetFilters = () => {
    form.resetFields();
    setQuery(DEFAULT_ADMIN_ORDER_QUERY);
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="订单列表加载失败"
      description={state.error}
      action={
        <Button
          size="small"
          onClick={() => setRetryVersion((value) => value + 1)}
        >
          重试
        </Button>
      }
    />
  ) : null;

  if (state.data === null) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? (
          <Spin tip="正在加载订单列表" />
        ) : null}
      </Space>
    );
  }

  const orders = state.data.items;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新订单列表…
        </Typography.Text>
      ) : null}
      <Card
        title="全渠道订单"
        extra={
          <Space wrap>
            <Button onClick={() => exportPicking('detail')}>
              导出明细分拣单 CSV
            </Button>
            <Button onClick={() => exportPicking('summary')}>
              导出汇总分拣单 CSV
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            当前历史订单统一标记为“微信小程序”，渠道信息仅用于只读展示。
          </Typography.Text>
          <Form
            form={form}
            layout="inline"
            aria-label="全渠道订单筛选"
            onFinish={applyFilters}
          >
            <Form.Item name="keyword">
              <Input
                aria-label="订单关键词"
                allowClear
                placeholder="订单号、收货人或手机号"
                style={{ width: 220 }}
              />
            </Form.Item>
            <Form.Item name="order_type">
              <Select
                aria-label="订单类型"
                allowClear
                placeholder="订单类型"
                options={orderTypeOptions}
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="pickup_type">
              <Select
                aria-label="履约方式"
                allowClear
                placeholder="履约方式"
                options={pickupTypeOptions}
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="pay_status">
              <Select
                aria-label="支付状态"
                allowClear
                placeholder="支付状态"
                options={payStatusOptions}
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="order_status">
              <Select
                aria-label="订单状态"
                allowClear
                placeholder="订单状态"
                options={orderStatusOptions}
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item name="refund_status">
              <Select
                aria-label="退款状态"
                allowClear
                placeholder="退款状态"
                options={refundStatusOptions}
                style={{ width: 130 }}
              />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  查询
                </Button>
                <Button onClick={resetFilters}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
          <Table
            rowKey="id"
            dataSource={orders}
            pagination={{
              current: state.data.page,
              pageSize: state.data.page_size,
              total: state.data.total,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page, pageSize) =>
                setQuery((current) =>
                  changeOrderPage(current, page, pageSize),
                ),
            }}
            scroll={{ x: 1800 }}
            columns={[
              { title: '订单号', dataIndex: 'order_no', fixed: 'left' },
              {
                title: '渠道',
                render: (_: unknown, order: AdminOrderListItem) =>
                  order.channel.label,
              },
              {
                title: '订单类型',
                render: (_: unknown, order: AdminOrderListItem) =>
                  orderTypeLabel(order),
              },
              {
                title: '商品',
                render: (_: unknown, order: AdminOrderListItem) =>
                  order.product?.name ?? '-',
              },
              {
                title: '用户',
                render: (_: unknown, order: AdminOrderListItem) =>
                  order.user.nickname,
              },
              {
                title: '履约方式',
                render: (_: unknown, order: AdminOrderListItem) =>
                  pickupTypeLabel(order),
              },
              {
                title: '社区 / 自提点',
                render: (_: unknown, order: AdminOrderListItem) =>
                  order.community?.name ??
                  order.pickup_store?.name ??
                  '-',
              },
              {
                title: '金额',
                render: (_: unknown, order: AdminOrderListItem) =>
                  `¥${formatYuan(order.pay_amount_cents)}`,
              },
              { title: '支付状态', dataIndex: 'pay_status' },
              { title: '订单状态', dataIndex: 'order_status' },
              { title: '退款状态', dataIndex: 'refund_status' },
              {
                title: '收货信息',
                render: (_: unknown, order: AdminOrderListItem) =>
                  [
                    order.receiver_name,
                    order.receiver_phone_masked,
                    order.receiver_address_masked,
                  ]
                    .filter(Boolean)
                    .join(' / '),
              },
              {
                title: '操作',
                fixed: 'right',
                render: (_: unknown, order: AdminOrderListItem) => (
                  <Space wrap>
                    <Button onClick={() => loadOrderContext(order)}>
                      详情
                    </Button>
                    <Button onClick={() => markOrder(order, 'preparing')}>
                      备货中
                    </Button>
                    <Button onClick={() => markOrder(order, 'ready')}>
                      待自提
                    </Button>
                    <Button onClick={() => pickupVerify(order)}>
                      核销自提
                    </Button>
                    <Button onClick={() => markOrder(order, 'picked')}>
                      已自提
                    </Button>
                    <Button onClick={() => markOrder(order, 'completed')}>
                      完成
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </Space>
      </Card>

      {selectedOrderContext ? (
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
            {formatYuan(
              selectedOrderContext.credit_usage?.amount_cents ?? 0,
            )}
            ；来源：
            {selectedOrderContext.credit_usage?.from_reward_conversion
              ? '开团服务奖励转平台消费额度'
              : '-'}
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
              { title: '事件', dataIndex: 'event_type' },
              { title: '标题', dataIndex: 'title' },
              { title: '时间', dataIndex: 'created_at' },
            ]}
          />
          <Typography.Title level={4}>BusinessEventLog</Typography.Title>
          <Table
            rowKey="id"
            dataSource={selectedOrderContext.business_events}
            pagination={false}
            columns={[
              { title: '事件', dataIndex: 'event_type' },
              { title: '级别', dataIndex: 'event_level' },
              { title: '说明', dataIndex: 'message' },
            ]}
          />
          <Typography.Title level={4}>OpsAlertLog</Typography.Title>
          <Table
            rowKey="id"
            dataSource={selectedOrderContext.alerts}
            pagination={false}
            columns={[
              { title: '类型', dataIndex: 'alert_type' },
              { title: '级别', dataIndex: 'alert_level' },
              { title: '状态', dataIndex: 'status' },
              { title: '标题', dataIndex: 'title' },
            ]}
          />
        </Card>
      ) : null}
    </Space>
  );
}
