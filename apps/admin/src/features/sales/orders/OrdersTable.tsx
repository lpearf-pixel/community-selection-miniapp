import { Button, Space, Table } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type {
  AdminOrderListItem,
  AdminOrderListResponse,
} from './types';

export type OrdersTableProps = {
  data: AdminOrderListResponse;
  onPageChange: (page: number, pageSize: number) => void;
  onLoadContext: (order: AdminOrderListItem) => void;
  onMarkOrder: (order: AdminOrderListItem, nextStatus: string) => void;
  onVerifyPickup: (order: AdminOrderListItem) => void;
  pendingPickupOrderIds: ReadonlySet<string>;
};

export function OrdersTable(props: OrdersTableProps) {
  return (
    <Table
      rowKey="id"
      dataSource={props.data.items}
      pagination={{
        current: props.data.pagination.page,
        pageSize: props.data.pagination.page_size,
        total: props.data.pagination.total,
        showSizeChanger: true,
        showTotal: (total) => `共 ${total} 条`,
        onChange: props.onPageChange,
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
            order.order_type === 'group_buy' ? '团购订单' : '普通购买',
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
            order.pickup_type === 'delivery' ? '配送到家' : '到店自提',
        },
        {
          title: '社区 / 自提点',
          render: (_: unknown, order: AdminOrderListItem) =>
            order.community?.name ?? order.pickup_store?.name ?? '-',
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
              <Button onClick={() => props.onLoadContext(order)}>详情</Button>
              <Button
                onClick={() => props.onMarkOrder(order, 'preparing')}
              >
                备货中
              </Button>
              <Button onClick={() => props.onMarkOrder(order, 'ready')}>
                待自提
              </Button>
              {order.pickup_type === 'store' &&
              order.order_status === 'ready' ? (
                <Button
                  disabled={props.pendingPickupOrderIds.has(order.id)}
                  onClick={() => props.onVerifyPickup(order)}
                >
                  核销自提
                </Button>
              ) : null}
              <Button
                onClick={() => props.onMarkOrder(order, 'completed')}
              >
                完成
              </Button>
            </Space>
          ),
        },
      ]}
    />
  );
}
