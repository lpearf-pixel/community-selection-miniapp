import { Button, Form, Input, Select, Space } from 'antd';
import type { FormInstance } from 'antd';
import type { AdminOrderFilters } from './page-model';

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

export type OrdersFiltersProps = {
  form: FormInstance<AdminOrderFilters>;
  onFinish: (filters: AdminOrderFilters) => void;
  onReset: () => void;
};

export function OrdersFilters(props: OrdersFiltersProps) {
  return (
    <Form
      form={props.form}
      layout="inline"
      aria-label="全渠道订单筛选"
      onFinish={props.onFinish}
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
          <Button onClick={props.onReset}>重置</Button>
        </Space>
      </Form.Item>
    </Form>
  );
}
