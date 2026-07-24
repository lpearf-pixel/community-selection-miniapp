import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';
import { featureErrorMessage } from '../../../shared/state/feature-resource';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import {
  approveWithdrawal,
  getWithdrawalDetail,
  listWithdrawals,
  markWithdrawalPaid,
  rejectWithdrawal,
} from './api';
import type { Withdrawal, WithdrawalDetail } from './types';
import { WithdrawalDetailDrawer } from './WithdrawalDetailDrawer';
import { WithdrawalFeedback, WithdrawalsWorkbench } from './WithdrawalsWorkbench';

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
  const { state, retry } = useFeatureResourceLoader(load, props.refreshVersion);

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
      action={<Button size="small" onClick={retry}>重试</Button>}
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

  const run = (
    item: Withdrawal,
    title: string,
    label: string,
    action: (id: string, value: string) => Promise<void>,
  ) =>
    void promptForAction(title, label, (value) =>
      action(item.withdrawal_id, value),
    );
  const search = () => {
    setAppliedKeyword(keyword);
    setPage(1);
    setQueryVersion((version) => version + 1);
  };
  const markPaid = (item: Withdrawal) => void promptForAction(
    '人工标记已处理',
    '人工转账记录号或内部处理编号',
    (value) => markWithdrawalPaid(item.withdrawal_id, value, '人工处理完成'),
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      <WithdrawalFeedback
        actionError={actionError}
        detailError={detailError}
        onClearActionError={() => setActionError('')}
        onClearDetailError={() => setDetailError('')}
      />
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新提现管理…
        </Typography.Text>
      ) : null}
      <WithdrawalsWorkbench
        data={state.data}
        refreshing={state.status === 'refreshing'}
        status={status}
        keyword={keyword}
        acting={acting}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        onKeywordChange={setKeyword}
        onSearch={search}
        onRangeChange={(value) => {
          setRange(value);
          setPage(1);
        }}
        onPageChange={setPage}
        onOpenDetail={(item) => void openDetail(item.withdrawal_id)}
        onApprove={(item) =>
          run(item, '审核通过', '审核备注', approveWithdrawal)
        }
        onReject={(item) =>
          run(item, '驳回', '驳回原因', rejectWithdrawal)
        }
        onMarkPaid={markPaid}
      />
      <WithdrawalDetailDrawer
        detail={detail}
        onClose={() => setDetail(null)}
      />
    </Space>
  );
}
