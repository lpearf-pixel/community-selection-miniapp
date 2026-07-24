import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Input,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { formatYuan } from '@community-selection/shared';
import { featureErrorMessage } from '../../../shared/state/feature-resource';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import {
  approveWithdrawal,
  getWithdrawalDetail,
  listWithdrawals,
  markWithdrawalPaid,
  rejectWithdrawal,
} from './api';
import type {
  Withdrawal,
  WithdrawalDetail,
  WithdrawalStatus,
} from './types';

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

export type WithdrawalsPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function WithdrawalsPage(props: WithdrawalsPageProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [queryVersion, setQueryVersion] = useState(0);
  const [range, setRange] = useState<[string, string] | undefined>();
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');
  const [detail, setDetail] = useState<WithdrawalDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const detailRequestRef = useRef<AbortController | null>(null);

  const load = useCallback(
    (signal: AbortSignal) =>
      listWithdrawals(
        {
          status,
          keyword: appliedKeyword,
          from: range?.[0],
          to: range?.[1],
          page,
          page_size: 20,
        },
        undefined,
        signal,
      ),
    [appliedKeyword, page, queryVersion, range, status],
  );
  const { state, retry } = useFeatureResourceLoader(
    load,
    props.refreshVersion,
  );

  useEffect(
    () => () => {
      detailRequestRef.current?.abort();
    },
    [],
  );

  const openDetail = async (id: string) => {
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setDetailError('');
    try {
      const nextDetail = await getWithdrawalDetail(
        id,
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setDetail(nextDetail);
    } catch (error) {
      if (!controller.signal.aborted) {
        setDetailError(featureErrorMessage(error));
      }
    } finally {
      if (detailRequestRef.current === controller) {
        detailRequestRef.current = null;
      }
    }
  };

  const promptForAction = async (
    title: string,
    label: string,
    action: (value: string) => Promise<void>,
  ) => {
    const value = window.prompt(`${title}：${label}`);
    if (!value?.trim()) {
      props.onMessage(`${label}必填`);
      return;
    }

    setActing(true);
    setActionError('');
    try {
      await action(value.trim());
      props.onMessage(
        '操作成功，仅人工审核与人工处理记录，系统不会自动打款',
      );
      props.onMutationCommitted();
    } catch (error) {
      setActionError(featureErrorMessage(error));
    } finally {
      setActing(false);
    }
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="提现管理加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载提现管理" /> : null}
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
          message="提现操作失败"
          description={actionError}
          closable
          onClose={() => setActionError('')}
        />
      ) : null}
      {detailError ? (
        <Alert
          type="error"
          showIcon
          message="提现详情加载失败"
          description={detailError}
          closable
          onClose={() => setDetailError('')}
        />
      ) : null}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新提现管理…
        </Typography.Text>
      ) : null}
      <Card
        title="L44 提现人工审核工作台"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="状态筛选"
              style={{ width: 140 }}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={(
                ['pending', 'approved', 'rejected', 'paid'] as const
              ).map((value) => ({
                value,
                label: statusText[value],
              }))}
            />
            <Input.Search
              placeholder="Leader ID/昵称/申请编号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onSearch={() => {
                setAppliedKeyword(keyword);
                setPage(1);
                setQueryVersion((version) => version + 1);
              }}
            />
            <DatePicker.RangePicker
              onChange={(_, values) => {
                setRange(
                  values[0] && values[1]
                    ? [values[0], values[1]]
                    : undefined,
                );
                setPage(1);
              }}
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
          loading={state.status === 'refreshing'}
          dataSource={state.data.items}
          pagination={{
            current: state.data.page,
            total: state.data.total,
            pageSize: state.data.page_size,
            onChange: setPage,
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
                  <Button
                    onClick={() => void openDetail(item.withdrawal_id)}
                  >
                    详情
                  </Button>
                  <Button
                    disabled={item.status !== 'pending' || acting}
                    onClick={() =>
                      void promptForAction(
                        '审核通过',
                        '审核备注',
                        (value) =>
                          approveWithdrawal(item.withdrawal_id, value),
                      )
                    }
                  >
                    审核通过
                  </Button>
                  <Button
                    danger
                    disabled={item.status !== 'pending' || acting}
                    onClick={() =>
                      void promptForAction(
                        '驳回',
                        '驳回原因',
                        (value) =>
                          rejectWithdrawal(item.withdrawal_id, value),
                      )
                    }
                  >
                    驳回
                  </Button>
                  <Button
                    type="primary"
                    disabled={item.status !== 'approved' || acting}
                    onClick={() =>
                      void promptForAction(
                        '人工标记已处理',
                        '人工转账记录号或内部处理编号',
                        (value) =>
                          markWithdrawalPaid(
                            item.withdrawal_id,
                            value,
                            '人工处理完成',
                          ),
                      )
                    }
                  >
                    标记已处理
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        <Drawer
          width={720}
          open={detail !== null}
          onClose={() => setDetail(null)}
          title="提现详情"
        >
          <pre>{detail ? JSON.stringify(detail, null, 2) : ''}</pre>
        </Drawer>
      </Card>
    </Space>
  );
}
