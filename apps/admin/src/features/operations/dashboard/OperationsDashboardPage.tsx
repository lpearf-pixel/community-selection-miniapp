import { useEffect, useReducer, useState } from 'react';
import { Alert, Button, Card, Space, Spin, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';
import { adminApiUrl } from '../../../shared/api/admin-api';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from '../../../shared/state/feature-resource';
import { loadOperationsDashboard } from './api';
import type {
  OperationsCommunityRow,
  OperationsDashboardData,
  OperationsPickupStoreRow,
  OperationsProductRow,
  OperationsTrendRow,
} from './types';

export type OperationsDashboardPageProps = {
  refreshVersion: number;
};

export function OperationsDashboardPage(
  props: OperationsDashboardPageProps,
) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<OperationsDashboardData>,
    initialFeatureResourceState<OperationsDashboardData>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'started' });
    void loadOperationsDashboard(undefined, controller.signal).then(
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
      message="运营看板加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载运营看板" /> : null}
      </Space>
    );
  }

  const { overview, trends, products, communities, pickupStores, alerts } =
    state.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新运营看板…</Typography.Text>
      ) : null}
      <Card title="运营看板">
        <Space wrap>
          <Card title="今日订单数">{overview.order_count}</Card>
          <Card title="实收金额">¥{formatYuan(overview.paid_amount)}</Card>
          <Card title="退款金额">¥{formatYuan(overview.refunded_amount)}</Card>
          <Card title="净销售额">¥{formatYuan(overview.net_sales_amount)}</Card>
          <Card title="售后率">
            {(overview.after_sale_rate * 100).toFixed(2)}%
          </Card>
          <Card title="退款率">{(overview.refund_rate * 100).toFixed(2)}%</Card>
          <Card title="自提完成数">{overview.pickup_completed_count}</Card>
          <Card title="库存损耗估算">
            ¥{formatYuan(overview.inventory_loss_estimated_amount)}
          </Card>
          <Card title="开团服务奖励金额">
            ¥{formatYuan(overview.service_reward_amount)}
          </Card>
        </Space>
        <Space style={{ marginTop: 16 }} wrap>
          <Button
            href={adminApiUrl(
              '/api/admin/operations/dashboard/export.csv?type=trends',
            )}
          >
            导出趋势 CSV
          </Button>
          <Button
            href={adminApiUrl(
              '/api/admin/operations/dashboard/export.csv?type=products',
            )}
          >
            导出商品排行 CSV
          </Button>
          <Button
            href={adminApiUrl(
              '/api/admin/operations/dashboard/export.csv?type=communities',
            )}
          >
            导出社区排行 CSV
          </Button>
          <Button
            href={adminApiUrl(
              '/api/admin/operations/dashboard/export.csv?type=pickup_stores',
            )}
          >
            导出自提点排行 CSV
          </Button>
          <Button
            href={adminApiUrl(
              '/api/admin/operations/dashboard/export.csv?type=alerts',
            )}
          >
            导出异常提醒 CSV
          </Button>
        </Space>
      </Card>
      <Card title="近 7 日趋势表">
        <Table
          rowKey="date"
          dataSource={trends}
          columns={[
            { title: 'date', dataIndex: 'date' },
            { title: 'order_count', dataIndex: 'order_count' },
            {
              title: 'paid_amount',
              render: (_: unknown, row: OperationsTrendRow) =>
                `¥${formatYuan(row.paid_amount)}`,
            },
            {
              title: 'refunded_amount',
              render: (_: unknown, row: OperationsTrendRow) =>
                `¥${formatYuan(row.refunded_amount)}`,
            },
            {
              title: 'net_sales_amount',
              render: (_: unknown, row: OperationsTrendRow) =>
                `¥${formatYuan(row.net_sales_amount)}`,
            },
            { title: 'after_sale_case_count', dataIndex: 'after_sale_case_count' },
            { title: 'inventory_loss_count', dataIndex: 'inventory_loss_count' },
          ]}
        />
      </Card>
      <Card title="商品排行表">
        <Table
          rowKey="product_id"
          dataSource={products}
          columns={[
            { title: '商品', dataIndex: 'product_name' },
            { title: '分类', dataIndex: 'category_name' },
            { title: '订单数', dataIndex: 'order_count' },
            { title: '销售数量', dataIndex: 'quantity_sold' },
            {
              title: '实收金额',
              render: (_: unknown, row: OperationsProductRow) =>
                `¥${formatYuan(row.paid_amount)}`,
            },
            {
              title: '退款金额',
              render: (_: unknown, row: OperationsProductRow) =>
                `¥${formatYuan(row.refunded_amount)}`,
            },
            {
              title: '净销售额',
              render: (_: unknown, row: OperationsProductRow) =>
                `¥${formatYuan(row.net_sales_amount)}`,
            },
            {
              title: '售后率',
              render: (_: unknown, row: OperationsProductRow) =>
                `${(row.after_sale_rate * 100).toFixed(2)}%`,
            },
            { title: '损耗数', dataIndex: 'inventory_loss_count' },
          ]}
        />
      </Card>
      <Card title="社区排行表">
        <Table
          rowKey="community_id"
          dataSource={communities}
          columns={[
            { title: '社区', dataIndex: 'community_name' },
            { title: '订单数', dataIndex: 'order_count' },
            {
              title: '实收金额',
              render: (_: unknown, row: OperationsCommunityRow) =>
                `¥${formatYuan(row.paid_amount)}`,
            },
            {
              title: '退款金额',
              render: (_: unknown, row: OperationsCommunityRow) =>
                `¥${formatYuan(row.refunded_amount)}`,
            },
            {
              title: '净销售额',
              render: (_: unknown, row: OperationsCommunityRow) =>
                `¥${formatYuan(row.net_sales_amount)}`,
            },
            { title: '自提完成数', dataIndex: 'pickup_completed_count' },
            { title: '售后数', dataIndex: 'after_sale_case_count' },
          ]}
        />
      </Card>
      <Card title="自提点履约表">
        <Table
          rowKey="pickup_store_id"
          dataSource={pickupStores}
          columns={[
            { title: '自提点', dataIndex: 'pickup_store_name' },
            { title: '订单数', dataIndex: 'order_count' },
            { title: '自提完成数', dataIndex: 'pickup_completed_count' },
            { title: '待自提数', dataIndex: 'pickup_pending_count' },
            {
              title: '自提完成率',
              render: (_: unknown, row: OperationsPickupStoreRow) =>
                `${(row.pickup_completion_rate * 100).toFixed(2)}%`,
            },
            { title: '售后数', dataIndex: 'after_sale_case_count' },
          ]}
        />
      </Card>
      <Card title="异常提醒列表">
        <Table
          rowKey="type"
          dataSource={alerts}
          columns={[
            { title: 'severity', dataIndex: 'severity' },
            { title: 'title', dataIndex: 'title' },
            { title: 'description', dataIndex: 'description' },
            { title: 'metric_value', dataIndex: 'metric_value' },
          ]}
        />
      </Card>
    </Space>
  );
}
