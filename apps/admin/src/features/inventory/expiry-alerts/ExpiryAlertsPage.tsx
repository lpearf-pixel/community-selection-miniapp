import {
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import { loadExpiryAlerts } from './api';
import type { ExpiryAlert } from '../shared/types';

const loadExpiryAlertResource = (signal: AbortSignal) =>
  loadExpiryAlerts(7, undefined, signal);

export type ExpiryAlertsPageProps = {
  refreshVersion: number;
};

export function ExpiryAlertsPage(props: ExpiryAlertsPageProps) {
  const { state, retry } = useFeatureResourceLoader<ExpiryAlert[]>(
    loadExpiryAlertResource,
    props.refreshVersion,
  );

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="临期提醒加载失败"
      description={state.error}
      action={
        <Button size="small" onClick={retry}>
          重试
        </Button>
      }
    />
  ) : null;

  if (state.data === null) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? <Spin tip="正在加载临期提醒" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新临期提醒…</Typography.Text>
      ) : null}
      <Card title="临期提醒（7 天）">
        <Table
          rowKey="batch_id"
          dataSource={state.data}
          columns={[
            { title: '批次号', dataIndex: 'batch_no' },
            { title: '商品', dataIndex: 'product_name' },
            { title: '供应商', dataIndex: 'supplier_name' },
            {
              title: '剩余数量',
              render: (_: unknown, item: ExpiryAlert) =>
                `${item.remaining_quantity} ${item.stock_unit}`,
            },
            {
              title: '过期日期',
              render: (_: unknown, item: ExpiryAlert) =>
                item.expire_at
                  ? new Date(item.expire_at).toLocaleDateString()
                  : '-',
            },
            { title: '剩余天数', dataIndex: 'days_to_expire' },
            { title: '提示', dataIndex: 'status_hint' },
          ]}
        />
      </Card>
    </Space>
  );
}
