import { Button, Card, Select, Space, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { GroupBuy } from '../shared/types';
import type { ClosureWorkbenchState } from './page-model';
import type { ManualRefundOrder } from './types';

export type GroupBuyClosureWorkbenchProps = {
  groupBuys: GroupBuy[];
  state: ClosureWorkbenchState;
  onSelect: (groupBuyId: string) => void;
  onReload: () => void;
  onMarkFailed: () => void;
  onCloseUnpaidOrders: () => void;
  onCloseFinally: () => void;
  onConfirmRefund: (order: ManualRefundOrder) => void;
};

export function GroupBuyClosureWorkbench(
  props: GroupBuyClosureWorkbenchProps,
) {
  const summary = props.state.closureSummary;

  return (
    <Card title="失败团购人工关闭工作台">
      <Typography.Paragraph>
        “标记失败”不等于退款完成；“关闭未支付订单”不会触发退款；“确认退款已完成”必须基于成功退款记录；“最终关闭”要求所有待办已完成。
      </Typography.Paragraph>
      <Space wrap>
        <Select
          style={{ width: 360 }}
          placeholder="选择团购"
          value={props.state.selectedGroupBuyId || undefined}
          onChange={props.onSelect}
          options={props.groupBuys.map((groupBuy) => ({
            label: `${groupBuy.product?.name ?? '团购'} / ${groupBuy.status} / ${new Date(groupBuy.end_time).toLocaleString()}`,
            value: groupBuy.id,
          }))}
        />
        <Button onClick={props.onReload}>查看关闭摘要</Button>
        <Button onClick={props.onMarkFailed}>标记失败</Button>
        <Button onClick={props.onCloseUnpaidOrders}>关闭未支付订单</Button>
        <Button type="primary" danger onClick={props.onCloseFinally}>
          最终关闭
        </Button>
      </Space>
      {summary ? (
        <Card title="团购关闭摘要" style={{ marginTop: 16 }}>
          <Typography.Paragraph>
            状态：{summary.status}；目标：{summary.target_count}；有效已支付数量：{summary.paid_quantity}；未支付待关闭：{summary.unpaid_order_count}；待人工退款：{summary.paid_pending_refund_count}；退款成功：{summary.refund_success_count}；待退金额：¥{formatYuan(summary.pending_refund_amount_cents)}；已退金额：¥{formatYuan(summary.total_refunded_amount_cents)}；库存扣减/回补/剩余：{summary.inventory_deducted_quantity}/{summary.inventory_restored_quantity}/{summary.inventory_remaining_restorable_quantity}；可关闭：{summary.closable ? '是' : '否'}
          </Typography.Paragraph>
          {summary.blockers.length > 0 ? (
            <Typography.Paragraph type="danger">
              阻塞原因：{summary.blockers.map((blocker) => `${blocker.type}(${blocker.count})`).join('，')}
            </Typography.Paragraph>
          ) : null}
        </Card>
      ) : null}
      <Table
        rowKey="order_id"
        dataSource={props.state.manualRefundOrders}
        columns={[
          { title: '订单号', dataIndex: 'order_no' },
          { title: '用户', dataIndex: 'user_id' },
          { title: '数量', dataIndex: 'quantity' },
          {
            title: '实付',
            render: (_: unknown, order: ManualRefundOrder) =>
              `¥${formatYuan(order.pay_amount_cents)}`,
          },
          {
            title: '已退',
            render: (_: unknown, order: ManualRefundOrder) =>
              `¥${formatYuan(order.refund_amount_cents)}`,
          },
          { title: '退款状态', dataIndex: 'refund_status' },
          { title: '关闭状态', dataIndex: 'closure_status' },
          { title: '最新退款单', dataIndex: 'latest_refund_id' },
          {
            title: '操作',
            render: (_: unknown, order: ManualRefundOrder) => (
              <Button onClick={() => props.onConfirmRefund(order)}>
                确认退款已完成
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
