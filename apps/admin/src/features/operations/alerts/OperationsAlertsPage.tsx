import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { featureErrorMessage } from '../../../shared/state/feature-resource';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import {
  ignoreOperationsAlert,
  listOperationsAlerts,
  resolveOperationsAlert,
} from './api';
import type { OperationsAlert } from './types';

const loadAlerts = (signal: AbortSignal) =>
  listOperationsAlerts(undefined, signal);

export type OperationsAlertsPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function OperationsAlertsPage(
  props: OperationsAlertsPageProps,
) {
  const [actingId, setActingId] = useState('');
  const [actionError, setActionError] = useState('');
  const { state, retry } = useFeatureResourceLoader(
    loadAlerts,
    props.refreshVersion,
  );

  const update = async (
    alert: OperationsAlert,
    action: 'resolve' | 'ignore',
  ) => {
    setActingId(alert.id);
    setActionError('');
    try {
      if (action === 'resolve') {
        await resolveOperationsAlert(alert.id);
      } else {
        await ignoreOperationsAlert(alert.id);
      }
      props.onMessage(action === 'resolve' ? '告警已处理' : '告警已忽略');
      props.onMutationCommitted();
    } catch (error) {
      setActionError(featureErrorMessage(error));
    } finally {
      setActingId('');
    }
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="运营告警加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载运营告警" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {actionError ? (
        <Alert
          type="error"
          showIcon
          message="告警操作失败"
          description={actionError}
          closable
          onClose={() => setActionError('')}
        />
      ) : null}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新运营告警…
        </Typography.Text>
      ) : null}
      <Card title="告警中心">
        <Table
          rowKey="id"
          loading={state.status === 'refreshing'}
          dataSource={state.data}
          columns={[
            { title: '类型', dataIndex: 'alert_type' },
            { title: '级别', dataIndex: 'alert_level' },
            { title: '状态', dataIndex: 'status' },
            { title: '订单', dataIndex: 'order_id' },
            { title: '标题', dataIndex: 'title' },
            { title: '说明', dataIndex: 'message' },
            {
              title: '操作',
              render: (_: unknown, item: OperationsAlert) => (
                <Space>
                  <Button
                    loading={actingId === item.id}
                    onClick={() => void update(item, 'resolve')}
                  >
                    resolve
                  </Button>
                  <Button
                    loading={actingId === item.id}
                    onClick={() => void update(item, 'ignore')}
                  >
                    ignore
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
