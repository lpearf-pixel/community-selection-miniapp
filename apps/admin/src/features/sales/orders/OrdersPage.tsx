import { useEffect, useReducer, useState } from "react";
import {
  Alert,
  Button,
  Card,
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
import type { Order } from "../shared/types";
import {
  getPickingExportUrl,
  loadOrderAiContext,
  loadOrders,
  updateOrderStatus,
  verifyOrderPickup,
} from "./api";
import type { AiContext } from "./types";

export type OrdersPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function OrdersPage(props: OrdersPageProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [selectedOrderContext, setSelectedOrderContext] =
    useState<AiContext | null>(null);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<Order[]>,
    initialFeatureResourceState<Order[]>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "started" });
    void loadOrders(undefined, controller.signal).then(
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

  const loadOrderContext = async (order: Order) => {
    const context = await loadOrderAiContext(order.id);
    setSelectedOrderContext(context);
    props.onMessage(`已加载订单 ${order.order_no} 全链路详情`);
  };

  const exportPicking = (format: "summary" | "detail") => {
    window.location.href = getPickingExportUrl(format);
  };

  const pickupVerify = async (order: Order) => {
    await verifyOrderPickup(order.id, "后台核销自提");
    props.onMessage(`订单 ${order.order_no} 已核销自提`);
    props.onMutationCommitted();
  };

  const markOrder = async (order: Order, nextStatus: string) => {
    await updateOrderStatus(order.id, nextStatus);
    props.onMessage(`订单 ${order.order_no} 已更新为 ${nextStatus}`);
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="订单列表加载失败"
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
        {state.status !== "error" ? <Spin tip="正在加载订单列表" /> : null}
      </Space>
    );
  }

  const orders = state.data;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorAlert}
      {state.status === "refreshing" ? (
        <Typography.Text type="secondary">正在刷新订单列表…</Typography.Text>
      ) : null}
      <Card
        title="订单列表"
        extra={
          <Space>
            <Button onClick={() => exportPicking("detail")}>
              导出明细分拣单 CSV
            </Button>
            <Button onClick={() => exportPicking("summary")}>
              导出汇总分拣单 CSV
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={orders}
          columns={[
            { title: "订单号", dataIndex: "order_no" },
            {
              title: "商品",
              render: (_: unknown, order: Order) =>
                order.group_buy?.product?.name ?? order.product?.name ?? "-",
            },
            {
              title: "用户",
              render: (_: unknown, order: Order) =>
                order.user?.nickname ?? "-",
            },
            {
              title: "金额",
              render: (_: unknown, order: Order) =>
                `¥${formatYuan(order.pay_amount_cents)}`,
            },
            { title: "支付状态", dataIndex: "pay_status" },
            { title: "订单状态", dataIndex: "order_status" },
            { title: "收货人", dataIndex: "receiver_name" },
            {
              title: "操作",
              render: (_: unknown, order: Order) => (
                <Space>
                  <Button onClick={() => loadOrderContext(order)}>详情</Button>
                  <Button onClick={() => markOrder(order, "preparing")}>
                    备货中
                  </Button>
                  <Button onClick={() => markOrder(order, "ready")}>
                    待自提
                  </Button>
                  <Button onClick={() => pickupVerify(order)}>
                    核销自提
                  </Button>
                  <Button onClick={() => markOrder(order, "picked")}>
                    已自提
                  </Button>
                  <Button onClick={() => markOrder(order, "completed")}>
                    完成
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {selectedOrderContext ? (
        <Card title="订单全链路详情">
          <Typography.Title level={4}>订单基础信息</Typography.Title>
          <Typography.Paragraph>
            订单号：{selectedOrderContext.order.order_no}；状态：
            {selectedOrderContext.order.order_status}；支付状态：
            {selectedOrderContext.order.pay_status}；实付：¥
            {formatYuan(selectedOrderContext.order.pay_amount_cents)}
          </Typography.Paragraph>
          <Typography.Paragraph>
            消费额度抵扣：¥
            {formatYuan(selectedOrderContext.credit_usage?.amount_cents ?? 0)}
            ；来源：
            {selectedOrderContext.credit_usage?.from_reward_conversion
              ? "开团服务奖励转平台消费额度"
              : "-"}
          </Typography.Paragraph>
          <Typography.Title level={4}>
            支付 / 退款 / 开团服务奖励 / 提现或转消费额度信息
          </Typography.Title>
          <Typography.Paragraph>
            支付、退款、开团服务奖励与提现或转消费额度信息通过下方
            BusinessEventLog、OpsAlertLog 与 AI context 汇总展示。
          </Typography.Paragraph>
          <Typography.Title level={4}>
            OrderTimelineLog 时间线
          </Typography.Title>
          <Table
            rowKey="id"
            dataSource={selectedOrderContext.timeline}
            pagination={false}
            columns={[
              { title: "事件", dataIndex: "event_type" },
              { title: "标题", dataIndex: "title" },
              { title: "时间", dataIndex: "created_at" },
            ]}
          />
          <Typography.Title level={4}>BusinessEventLog</Typography.Title>
          <Table
            rowKey="id"
            dataSource={selectedOrderContext.business_events}
            pagination={false}
            columns={[
              { title: "事件", dataIndex: "event_type" },
              { title: "级别", dataIndex: "event_level" },
              { title: "说明", dataIndex: "message" },
            ]}
          />
          <Typography.Title level={4}>OpsAlertLog</Typography.Title>
          <Table
            rowKey="id"
            dataSource={selectedOrderContext.alerts}
            pagination={false}
            columns={[
              { title: "类型", dataIndex: "alert_type" },
              { title: "级别", dataIndex: "alert_level" },
              { title: "状态", dataIndex: "status" },
              { title: "标题", dataIndex: "title" },
            ]}
          />
        </Card>
      ) : null}
    </Space>
  );
}
