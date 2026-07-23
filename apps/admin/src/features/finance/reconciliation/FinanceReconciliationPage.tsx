import { useEffect, useReducer, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';
import { adminApiUrl } from '../../../shared/api/admin-api';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from '../../../shared/state/feature-resource';
import { loadFinanceReconciliation } from './api';
import type {
  FinanceAfterSaleRow,
  FinanceOrderRow,
  FinanceReconciliationData,
  FinanceRewardRow,
} from './types';

export type FinanceReconciliationPageProps = {
  refreshVersion: number;
};

export function FinanceReconciliationPage(
  props: FinanceReconciliationPageProps,
) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<FinanceReconciliationData>,
    initialFeatureResourceState<FinanceReconciliationData>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'started' });
    void loadFinanceReconciliation(undefined, controller.signal).then(
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
  }, [props.refreshVersion, retryVersion]);

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="财务对账加载失败"
      description={state.error}
      action={
        <Button size="small" onClick={() => setRetryVersion((value) => value + 1)}>
          重试
        </Button>
      }
    />
  ) : null;

  if (state.data === null) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? <Spin tip="正在加载财务对账" /> : null}
      </Space>
    );
  }

  const { overview, orders, rewards, afterSales } = state.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新财务对账…</Typography.Text>
      ) : null}
      <Card title="财务对账">
        <Space wrap>
          <Card title="实收金额">¥{formatYuan(overview.paid_amount)}</Card>
          <Card title="退款金额">¥{formatYuan(overview.refunded_amount)}</Card>
          <Card title="净销售额">¥{formatYuan(overview.net_sales_amount)}</Card>
          <Card title="售后单数">{overview.after_sale_case_count}</Card>
          <Card title="库存损耗估算">
            ¥{formatYuan(overview.inventory_loss_estimated_amount)}
          </Card>
          <Card title="开团服务奖励估算">
            ¥{formatYuan(overview.service_reward_estimated_amount)}
          </Card>
          <Card title="待税务审核数量">
            {overview.tax_review_pending_count}
          </Card>
          <Card title="已打款提现金额">
            ¥{formatYuan(overview.withdrawal_paid_amount)}
          </Card>
        </Space>
        <Space style={{ marginTop: 16 }} wrap>
          <Button
            href={adminApiUrl(
              '/api/admin/finance/reconciliation/export.csv?type=orders',
            )}
          >
            导出订单对账 CSV
          </Button>
          <Button
            href={adminApiUrl(
              '/api/admin/finance/reconciliation/export.csv?type=rewards',
            )}
          >
            导出开团服务奖励 CSV
          </Button>
          <Button
            href={adminApiUrl(
              '/api/admin/finance/reconciliation/export.csv?type=after_sales',
            )}
          >
            导出售后退款 CSV
          </Button>
        </Space>
      </Card>
      <Card title="订单对账表">
        <Table
          rowKey="order_id"
          dataSource={orders}
          columns={[
            { title: 'order id', dataIndex: 'order_id' },
            { title: '状态', dataIndex: 'order_status' },
            {
              title: '支付金额',
              render: (_: unknown, row: FinanceOrderRow) =>
                `¥${formatYuan(row.paid_amount)}`,
            },
            {
              title: '退款金额',
              render: (_: unknown, row: FinanceOrderRow) =>
                `¥${formatYuan(row.refunded_amount)}`,
            },
            {
              title: '净额',
              render: (_: unknown, row: FinanceOrderRow) =>
                `¥${formatYuan(row.net_amount)}`,
            },
            { title: '售后数量', dataIndex: 'after_sale_case_count' },
            {
              title: '开团服务奖励金额',
              render: (_: unknown, row: FinanceOrderRow) =>
                `¥${formatYuan(row.commission_reward_amount)}`,
            },
          ]}
        />
      </Card>
      <Card title="开团服务奖励对账表">
        <Table
          rowKey="reward_id"
          dataSource={rewards}
          columns={[
            { title: 'leader_user_id', dataIndex: 'leader_user_id' },
            { title: 'order_id', dataIndex: 'order_id' },
            {
              title: 'reward_amount',
              render: (_: unknown, row: FinanceRewardRow) =>
                `¥${formatYuan(row.reward_amount)}`,
            },
            { title: 'reward_status', dataIndex: 'reward_status' },
            { title: 'available_at', dataIndex: 'available_at' },
            { title: 'withdrawal_id', dataIndex: 'withdrawal_id' },
            {
              title: 'recalculated_after_refund',
              render: (_: unknown, row: FinanceRewardRow) =>
                row.recalculated_after_refund ? '是' : '否',
            },
          ]}
        />
      </Card>
      <Card title="售后/退款对账表">
        <Table
          rowKey="after_sale_case_id"
          dataSource={afterSales}
          columns={[
            { title: 'after_sale_case_id', dataIndex: 'after_sale_case_id' },
            { title: 'order_id', dataIndex: 'order_id' },
            { title: 'type', dataIndex: 'type' },
            { title: 'status', dataIndex: 'status' },
            {
              title: 'requested_amount',
              render: (_: unknown, row: FinanceAfterSaleRow) =>
                `¥${formatYuan(row.requested_amount)}`,
            },
            {
              title: 'approved_amount',
              render: (_: unknown, row: FinanceAfterSaleRow) =>
                `¥${formatYuan(row.approved_amount)}`,
            },
            {
              title: 'resolved_amount',
              render: (_: unknown, row: FinanceAfterSaleRow) =>
                `¥${formatYuan(row.resolved_amount)}`,
            },
            {
              title: 'linked_inventory_loss_id',
              dataIndex: 'linked_inventory_loss_id',
            },
          ]}
        />
      </Card>
    </Space>
  );
}
