import { Card, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { AiContext } from './types';
import { WechatShippingSyncCard } from './WechatShippingSyncCard';

export type OrderDetailsCardProps = {
  context: AiContext;
  retryingShipping: boolean;
  onRetryShipping: () => void;
};

export function OrderDetailsCard({
  context,
  retryingShipping,
  onRetryShipping,
}: OrderDetailsCardProps) {
  return (
    <Card title="订单全链路详情">
      <Typography.Title level={4}>订单基础信息</Typography.Title>
      <Typography.Paragraph>
        订单号：{context.order.order_no}；状态：
        {context.order.order_status}；支付状态：
        {context.order.pay_status}；实付：¥
        {formatYuan(context.order.pay_amount_cents)}
      </Typography.Paragraph>
      <WechatShippingSyncCard
        summary={context.shipping_sync}
        retrying={retryingShipping}
        onRetry={onRetryShipping}
      />
      <Typography.Paragraph>
        消费额度抵扣：¥
        {formatYuan(context.credit_usage?.amount_cents ?? 0)}
        ；来源：
        {context.credit_usage?.from_reward_conversion
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
        dataSource={context.timeline}
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
        dataSource={context.business_events}
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
        dataSource={context.alerts}
        pagination={false}
        columns={[
          { title: '类型', dataIndex: 'alert_type' },
          { title: '级别', dataIndex: 'alert_level' },
          { title: '状态', dataIndex: 'status' },
          { title: '标题', dataIndex: 'title' },
        ]}
      />
    </Card>
  );
}
