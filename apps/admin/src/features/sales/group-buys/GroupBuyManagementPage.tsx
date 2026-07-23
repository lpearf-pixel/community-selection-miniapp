import { useEffect, useReducer, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Select,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import { formatYuan } from "@community-selection/shared";
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from "../../../shared/state/feature-resource";
import type { GroupBuy } from "../shared/types";
import {
  cloneGroupBuy,
  closeGroupBuy,
  closeUnpaidOrders,
  confirmRefund,
  loadClosureWorkbench,
  loadGroupBuys,
  markGroupBuyFailed,
} from "./api";
import {
  resolveClosureWorkbenchRequest,
  selectClosureGroupBuy,
  type ClosureWorkbenchRequestToken,
  type ClosureWorkbenchState,
} from "./page-model";
import type { ManualRefundOrder } from "./types";

export type GroupBuyManagementPageProps = {
  refreshVersion: number;
  activeView: "groupBuys" | "failedGroupBuyClosure";
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function GroupBuyManagementPage(
  props: GroupBuyManagementPageProps,
) {
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
    controller: AbortController;
    token: ClosureWorkbenchRequestToken;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "started" });
    void loadGroupBuys(undefined, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          dispatch({ type: "resolved", data });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          dispatch({
            type: "rejected",
            message: featureErrorMessage(error),
          });
        }
      },
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
      ) {
        return;
      }
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
      ) {
        return;
      }
      throw error;
    } finally {
      if (
        activeClosureRequestRef.current?.token.generation ===
        token.generation
      ) {
        activeClosureRequestRef.current = null;
      }
    }
  };

  const markSelectedGroupBuyFailed = async () => {
    if (!closureState.selectedGroupBuyId) return;
    await markGroupBuyFailed(closureState.selectedGroupBuyId);
    if (selectedClosureGroupBuyIdRef.current) {
      await reloadClosureWorkbench(selectedClosureGroupBuyIdRef.current);
    }
  };

  const closeSelectedUnpaidOrders = async () => {
    if (!closureState.selectedGroupBuyId) return;
    await closeUnpaidOrders(closureState.selectedGroupBuyId);
    if (selectedClosureGroupBuyIdRef.current) {
      await reloadClosureWorkbench(selectedClosureGroupBuyIdRef.current);
    }
  };

  const closeSelectedGroupBuyFinally = async () => {
    if (!closureState.selectedGroupBuyId) return;
    await closeGroupBuy(closureState.selectedGroupBuyId);
    if (selectedClosureGroupBuyIdRef.current) {
      await reloadClosureWorkbench(selectedClosureGroupBuyIdRef.current);
    }
  };

  const confirmRefundHandled = async (order: ManualRefundOrder) => {
    if (!closureState.selectedGroupBuyId || !order.latest_refund_id) {
      props.onMessage("确认退款已完成必须基于成功退款记录");
      return;
    }
    await confirmRefund(
      closureState.selectedGroupBuyId,
      order.order_id,
      order.latest_refund_id,
    );
    if (selectedClosureGroupBuyIdRef.current) {
      await reloadClosureWorkbench(selectedClosureGroupBuyIdRef.current);
    }
  };

  const cloneExistingGroupBuy = async (groupBuy: GroupBuy) => {
    const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const pickupTime = new Date(
      Date.now() + 48 * 60 * 60 * 1000,
    ).toISOString();
    await cloneGroupBuy(groupBuy.id, {
      end_time: endTime,
      pickup_time: pickupTime,
    });
    props.onMessage("已一键再开团");
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

  if (state.data === null) {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {errorAlert}
        {state.status !== "error" ? <Spin tip="正在加载团购列表" /> : null}
      </Space>
    );
  }

  const groupBuys = state.data;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorAlert}
      {state.status === "refreshing" ? (
        <Typography.Text type="secondary">正在刷新团购列表…</Typography.Text>
      ) : null}
      {props.activeView === "groupBuys" ? (
        <Card title="团购列表">
          <Table
            rowKey="id"
            dataSource={groupBuys}
            columns={[
              {
                title: "商品",
                render: (_: unknown, groupBuy: GroupBuy) =>
                  groupBuy.product?.name ?? "-",
              },
              {
                title: "社区",
                render: (_: unknown, groupBuy: GroupBuy) =>
                  groupBuy.community?.name ?? "-",
              },
              {
                title: "团购价",
                render: (_: unknown, groupBuy: GroupBuy) =>
                  `¥${formatYuan(groupBuy.price_cents)}`,
              },
              {
                title: "人数",
                render: (_: unknown, groupBuy: GroupBuy) =>
                  `${groupBuy.current_people}/${groupBuy.min_people}`,
              },
              {
                title: "数量",
                render: (_: unknown, groupBuy: GroupBuy) =>
                  `${groupBuy.current_quantity}/${groupBuy.min_quantity}`,
              },
              { title: "状态", dataIndex: "status" },
              {
                title: "截止时间",
                render: (_: unknown, groupBuy: GroupBuy) =>
                  new Date(groupBuy.end_time).toLocaleString(),
              },
              {
                title: "操作",
                render: (_: unknown, groupBuy: GroupBuy) => (
                  <Button onClick={() => cloneExistingGroupBuy(groupBuy)}>
                    一键再开团
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      ) : (
        <Card title="失败团购人工关闭工作台">
          <Typography.Paragraph>
            “标记失败”不等于退款完成；“关闭未支付订单”不会触发退款；“确认退款已完成”必须基于成功退款记录；“最终关闭”要求所有待办已完成。
          </Typography.Paragraph>
          <Space wrap>
            <Select
              style={{ width: 360 }}
              placeholder="选择团购"
              value={closureState.selectedGroupBuyId || undefined}
              onChange={(value: string) => {
                selectedClosureGroupBuyIdRef.current = value;
                setClosureState((current) =>
                  selectClosureGroupBuy(current, value),
                );
                void reloadClosureWorkbench(value);
              }}
              options={groupBuys.map((groupBuy) => ({
                label: `${groupBuy.product?.name ?? "团购"} / ${groupBuy.status} / ${new Date(groupBuy.end_time).toLocaleString()}`,
                value: groupBuy.id,
              }))}
            />
            <Button
              onClick={() =>
                closureState.selectedGroupBuyId &&
                reloadClosureWorkbench(closureState.selectedGroupBuyId)
              }
            >
              查看关闭摘要
            </Button>
            <Button onClick={markSelectedGroupBuyFailed}>标记失败</Button>
            <Button onClick={closeSelectedUnpaidOrders}>
              关闭未支付订单
            </Button>
            <Button
              type="primary"
              danger
              onClick={closeSelectedGroupBuyFinally}
            >
              最终关闭
            </Button>
          </Space>
          {closureState.closureSummary ? (
            <Card title="团购关闭摘要" style={{ marginTop: 16 }}>
              <Typography.Paragraph>
                状态：{closureState.closureSummary.status}；目标：{closureState.closureSummary.target_count}；有效已支付数量：{closureState.closureSummary.paid_quantity}；未支付待关闭：{closureState.closureSummary.unpaid_order_count}；待人工退款：{closureState.closureSummary.paid_pending_refund_count}；退款成功：{closureState.closureSummary.refund_success_count}；待退金额：¥{formatYuan(closureState.closureSummary.pending_refund_amount_cents)}；已退金额：¥{formatYuan(closureState.closureSummary.total_refunded_amount_cents)}；库存扣减/回补/剩余：{closureState.closureSummary.inventory_deducted_quantity}/{closureState.closureSummary.inventory_restored_quantity}/{closureState.closureSummary.inventory_remaining_restorable_quantity}；可关闭：{closureState.closureSummary.closable ? "是" : "否"}
              </Typography.Paragraph>
              {closureState.closureSummary.blockers.length > 0 ? (
                <Typography.Paragraph type="danger">
                  阻塞原因：{closureState.closureSummary.blockers.map((blocker) => `${blocker.type}(${blocker.count})`).join("，")}
                </Typography.Paragraph>
              ) : null}
            </Card>
          ) : null}
          <Table
            rowKey="order_id"
            dataSource={closureState.manualRefundOrders}
            columns={[
              { title: "订单号", dataIndex: "order_no" },
              { title: "用户", dataIndex: "user_id" },
              { title: "数量", dataIndex: "quantity" },
              {
                title: "实付",
                render: (_: unknown, order: ManualRefundOrder) =>
                  `¥${formatYuan(order.pay_amount_cents)}`,
              },
              {
                title: "已退",
                render: (_: unknown, order: ManualRefundOrder) =>
                  `¥${formatYuan(order.refund_amount_cents)}`,
              },
              { title: "退款状态", dataIndex: "refund_status" },
              { title: "关闭状态", dataIndex: "closure_status" },
              { title: "最新退款单", dataIndex: "latest_refund_id" },
              {
                title: "操作",
                render: (_: unknown, order: ManualRefundOrder) => (
                  <Button onClick={() => confirmRefundHandled(order)}>
                    确认退款已完成
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
    </Space>
  );
}
