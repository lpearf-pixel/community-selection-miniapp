import { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from '../../../shared/state/feature-resource';
import type { GroupBuy } from '../shared/types';
import {
  cloneGroupBuy, closeGroupBuy, closeUnpaidOrders, confirmRefund,
  loadClosureWorkbench, loadGroupBuys, markGroupBuyFailed,
} from './api';
import { GroupBuyClosureWorkbench } from './GroupBuyClosureWorkbench';
import { GroupBuyListCard } from './GroupBuyListCard';
import {
  resolveClosureWorkbenchRequest, selectClosureGroupBuy,
  type ClosureWorkbenchRequestToken,
  type ClosureWorkbenchState,
} from './page-model';
import type { ManualRefundOrder } from './types';

export type GroupBuyManagementPageProps = {
  refreshVersion: number;
  activeView: 'groupBuys' | 'failedGroupBuyClosure';
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function GroupBuyManagementPage(props: GroupBuyManagementPageProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<GroupBuy[]>,
    initialFeatureResourceState<GroupBuy[]>(),
  );
  const [closureState, setClosureState] = useState<ClosureWorkbenchState>({
    selectedGroupBuyId: null,
    closureSummary: null,
    manualRefundOrders: [],
  });
  const selectedClosureGroupBuyIdRef = useRef<string | null>(null);
  const closureRequestGenerationRef = useRef(0);
  const activeClosureRequestRef = useRef<{
    controller: AbortController; token: ClosureWorkbenchRequestToken;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'started' });
    void loadGroupBuys(undefined, controller.signal).then(
      (data) =>
        !controller.signal.aborted && dispatch({ type: 'resolved', data }),
      (error: unknown) =>
        !controller.signal.aborted &&
        dispatch({ type: 'rejected', message: featureErrorMessage(error) }),
    );
    return () => controller.abort();
  }, [props.refreshVersion, retryVersion]);
  useEffect(
    () => () => {
      closureRequestGenerationRef.current += 1;
      selectedClosureGroupBuyIdRef.current = null;
      activeClosureRequestRef.current?.controller.abort();
      activeClosureRequestRef.current = null;
    },
    [],
  );
  const reloadClosureWorkbench = async (groupBuyId: string) => {
    if (!groupBuyId) return;
    activeClosureRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const token = {
      generation: closureRequestGenerationRef.current + 1,
      groupBuyId,
    };
    closureRequestGenerationRef.current = token.generation;
    activeClosureRequestRef.current = { controller, token };
    try {
      const workbench = await loadClosureWorkbench(
        groupBuyId,
        undefined,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        closureRequestGenerationRef.current !== token.generation ||
        selectedClosureGroupBuyIdRef.current !== token.groupBuyId
      )
        return;
      setClosureState((current) =>
        resolveClosureWorkbenchRequest(
          current,
          workbench,
          token,
          closureRequestGenerationRef.current,
        ),
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        closureRequestGenerationRef.current !== token.generation ||
        selectedClosureGroupBuyIdRef.current !== token.groupBuyId
      )
        return;
      throw error;
    } finally {
      if (
        activeClosureRequestRef.current?.token.generation === token.generation
      )
        activeClosureRequestRef.current = null;
    }
  };
  const mutateSelectedGroupBuy = async (
    mutation: (groupBuyId: string) => Promise<void>,
  ) => {
    if (!closureState.selectedGroupBuyId) return;
    await mutation(closureState.selectedGroupBuyId);
    if (selectedClosureGroupBuyIdRef.current)
      await reloadClosureWorkbench(selectedClosureGroupBuyIdRef.current);
  };
  const confirmRefundHandled = async (order: ManualRefundOrder) => {
    if (!closureState.selectedGroupBuyId || !order.latest_refund_id) {
      props.onMessage('确认退款已完成必须基于成功退款记录');
      return;
    }
    await confirmRefund(
      closureState.selectedGroupBuyId,
      order.order_id,
      order.latest_refund_id,
    );
    if (selectedClosureGroupBuyIdRef.current)
      await reloadClosureWorkbench(selectedClosureGroupBuyIdRef.current);
  };
  const cloneExistingGroupBuy = async (groupBuy: GroupBuy) => {
    await cloneGroupBuy(groupBuy.id, {
      end_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      pickup_time: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    });
    props.onMessage('已一键再开团');
    props.onMutationCommitted();
  };
  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="团购列表加载失败"
      description={state.error}
      action={
        <Button
          size="small"
          onClick={() => setRetryVersion((value) => value + 1)}
        >
          重试
        </Button>
      }
    />
  ) : null;
  if (state.data === null)
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? <Spin tip="正在加载团购列表" /> : null}
      </Space>
    );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新团购列表…</Typography.Text>
      ) : null}
      {props.activeView === 'groupBuys' ? (
        <GroupBuyListCard
          groupBuys={state.data}
          onClone={(groupBuy) => void cloneExistingGroupBuy(groupBuy)}
        />
      ) : (
        <GroupBuyClosureWorkbench
          groupBuys={state.data}
          state={closureState}
          onSelect={(groupBuyId) => {
            selectedClosureGroupBuyIdRef.current = groupBuyId;
            setClosureState((current) =>
              selectClosureGroupBuy(current, groupBuyId),
            );
            void reloadClosureWorkbench(groupBuyId);
          }}
          onReload={() =>
            closureState.selectedGroupBuyId &&
            void reloadClosureWorkbench(closureState.selectedGroupBuyId)
          }
          onMarkFailed={() => void mutateSelectedGroupBuy(markGroupBuyFailed)}
          onCloseUnpaidOrders={() => void mutateSelectedGroupBuy(closeUnpaidOrders)}
          onCloseFinally={() => void mutateSelectedGroupBuy(closeGroupBuy)}
          onConfirmRefund={(order) => void confirmRefundHandled(order)}
        />
      )}
    </Space>
  );
}
