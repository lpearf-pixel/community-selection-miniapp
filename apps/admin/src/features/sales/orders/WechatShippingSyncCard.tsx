import { Button, Descriptions, Space, Typography } from 'antd';
import type { WechatShippingSyncSummary } from './types';

const labels: Record<WechatShippingSyncSummary['status'], string> = {
  not_applicable: '不适用',
  pending: '待同步',
  processing: '同步中',
  retryable: '等待重试',
  succeeded: '已同步',
  manual_required: '需人工处理',
};

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

export function WechatShippingSyncCard(props: {
  summary: WechatShippingSyncSummary;
  retrying: boolean;
  onRetry: () => void;
}) {
  const actionable =
    props.summary.status === 'retryable' ||
    props.summary.status === 'manual_required';
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Title level={4}>微信发货信息同步</Typography.Title>
      <Descriptions size="small" column={2}>
        <Descriptions.Item label="状态">
          {labels[props.summary.status]}
        </Descriptions.Item>
        <Descriptions.Item label="尝试次数">
          {props.summary.attempts}
        </Descriptions.Item>
        <Descriptions.Item label="最后错误码">
          {props.summary.last_error_code ?? '-'}
        </Descriptions.Item>
        <Descriptions.Item label="下次重试">
          {displayTime(props.summary.next_retry_at)}
        </Descriptions.Item>
        <Descriptions.Item label="同步成功时间">
          {displayTime(props.summary.succeeded_at)}
        </Descriptions.Item>
      </Descriptions>
      {actionable ? (
        <Button
          loading={props.retrying}
          onClick={props.onRetry}
        >
          重新加入同步队列
        </Button>
      ) : null}
    </Space>
  );
}
