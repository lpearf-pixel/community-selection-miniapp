import {
  Alert,
  Button,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { Withdrawal, WithdrawalList, WithdrawalStatus } from './types';

const statusText: Record<WithdrawalStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  paid: '已处理',
};

const statusColor: Record<WithdrawalStatus, string> = {
  pending: 'orange',
  approved: 'blue',
  rejected: 'red',
  paid: 'green',
};

type WithdrawalsWorkbenchProps = {
  data: WithdrawalList;
  refreshing: boolean;
  status?: string;
  keyword: string;
  acting: boolean;
  onStatusChange: (value?: string) => void;
  onKeywordChange: (value: string) => void;
  onSearch: () => void;
  onRangeChange: (range?: [string, string]) => void;
  onPageChange: (page: number) => void;
  onOpenDetail: (item: Withdrawal) => void;
  onApprove: (item: Withdrawal) => void;
  onReject: (item: Withdrawal) => void;
  onMarkPaid: (item: Withdrawal) => void;
};

type WithdrawalFeedbackProps = {
  actionError: string;
  detailError: string;
  onClearActionError: () => void;
  onClearDetailError: () => void;
};

export function WithdrawalLoadError(props: {
  error: string;
  onRetry: () => void;
}) {
  return props.error ? (
    <Alert
      type="error"
      showIcon
      message="提现管理加载失败"
      description={props.error}
      action={
        <Button size="small" onClick={props.onRetry}>
          重试
        </Button>
      }
    />
  ) : null;
}

export function WithdrawalFeedback(props: WithdrawalFeedbackProps) {
  return (
    <>
      {props.actionError ? (
        <Alert
          type="error"
          showIcon
          message="提现操作失败"
          description={props.actionError}
          closable
          onClose={props.onClearActionError}
        />
      ) : null}
      {props.detailError ? (
        <Alert
          type="error"
          showIcon
          message="提现详情加载失败"
          description={props.detailError}
          closable
          onClose={props.onClearDetailError}
        />
      ) : null}
    </>
  );
}

export function WithdrawalsWorkbench(props: WithdrawalsWorkbenchProps) {
  return (
    <Card
      title="L44 提现人工审核工作台"
      extra={
        <Space wrap>
          <Select
            allowClear
            placeholder="状态筛选"
            style={{ width: 140 }}
            value={props.status}
            onChange={props.onStatusChange}
            options={(
              ['pending', 'approved', 'rejected', 'paid'] as const
            ).map((value) => ({
              value,
              label: statusText[value],
            }))}
          />
          <Input.Search
            placeholder="Leader ID/昵称/申请编号"
            value={props.keyword}
            onChange={(event) => props.onKeywordChange(event.target.value)}
            onSearch={props.onSearch}
          />
          <DatePicker.RangePicker
            onChange={(_, values) =>
              props.onRangeChange(
                values[0] && values[1]
                  ? [values[0], values[1]]
                  : undefined,
              )
            }
          />
        </Space>
      }
    >
      <Typography.Paragraph type="warning">
        仅人工审核与人工处理记录；审核通过后由工作人员线下处理，系统不会自动打款。遇到
        ADMIN_SCOPE_FORBIDDEN
        表示当前账号无该提现全部关联社区/订单的数据范围。
      </Typography.Paragraph>
      <Table
        rowKey="withdrawal_id"
        loading={props.refreshing}
        dataSource={props.data.items}
        pagination={{
          current: props.data.page,
          total: props.data.total,
          pageSize: props.data.page_size,
          onChange: props.onPageChange,
        }}
        columns={[
          { title: '申请编号', dataIndex: 'client_request_id' },
          {
            title: 'Leader',
            render: (_: unknown, item: Withdrawal) =>
              `${item.leader_nickname} ${item.leader_phone_masked ?? ''}`,
          },
          {
            title: '社区',
            render: (_: unknown, item: Withdrawal) =>
              item.community_names.join('、'),
          },
          {
            title: '金额',
            render: (_: unknown, item: Withdrawal) =>
              formatYuan(item.amount_cents),
          },
          {
            title: '状态',
            render: (_: unknown, item: Withdrawal) => (
              <Tag color={statusColor[item.status]}>
                {statusText[item.status]}
              </Tag>
            ),
          },
          { title: '奖励笔数', dataIndex: 'commission_count' },
          {
            title: '操作',
            render: (_: unknown, item: Withdrawal) => (
              <Space>
                <Button onClick={() => props.onOpenDetail(item)}>详情</Button>
                <Button
                  disabled={item.status !== 'pending' || props.acting}
                  onClick={() => props.onApprove(item)}
                >
                  审核通过
                </Button>
                <Button
                  danger
                  disabled={item.status !== 'pending' || props.acting}
                  onClick={() => props.onReject(item)}
                >
                  驳回
                </Button>
                <Button
                  type="primary"
                  disabled={item.status !== 'approved' || props.acting}
                  onClick={() => props.onMarkPaid(item)}
                >
                  标记已处理
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
