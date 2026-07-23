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
import { loadFulfillmentOverview } from "./api";
import type { FulfillmentOverview } from "./types";

export type FulfillmentOverviewPageProps = {
  refreshVersion: number;
};

export function FulfillmentOverviewPage(
  props: FulfillmentOverviewPageProps,
) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<FulfillmentOverview>,
    initialFeatureResourceState<FulfillmentOverview>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "started" });
    void loadFulfillmentOverview(undefined, controller.signal).then(
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

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="履约看板加载失败"
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
        {state.status !== "error" ? <Spin tip="正在加载履约看板" /> : null}
      </Space>
    );
  }

  const fulfillmentOverview = state.data;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorAlert}
      {state.status === "refreshing" ? (
        <Typography.Text type="secondary">正在刷新履约看板…</Typography.Text>
      ) : null}
      <Card title="履约看板">
        <Typography.Paragraph>
          今日团购：{fulfillmentOverview.today_group_buys}；待备货：
          {fulfillmentOverview.pending_prepare_orders}；待自提：
          {fulfillmentOverview.ready_pickup_orders}；已自提：
          {fulfillmentOverview.picked_orders}；已完成：
          {fulfillmentOverview.completed_orders}；异常：
          {fulfillmentOverview.abnormal_orders}
        </Typography.Paragraph>
        <Typography.Title level={4}>按社区</Typography.Title>
        <Table
          rowKey="community_id"
          dataSource={fulfillmentOverview.by_community}
          pagination={false}
          columns={[
            { title: "社区", dataIndex: "community_name" },
            { title: "订单数", dataIndex: "order_count" },
            { title: "数量", dataIndex: "quantity" },
            {
              title: "金额",
              render: (_: unknown, item: { amount_cents: number }) =>
                `¥${formatYuan(item.amount_cents)}`,
            },
          ]}
        />
        <Typography.Title level={4}>按商品</Typography.Title>
        <Table
          rowKey="product_id"
          dataSource={fulfillmentOverview.by_product}
          pagination={false}
          columns={[
            { title: "商品", dataIndex: "product_name" },
            { title: "数量", dataIndex: "quantity" },
            { title: "订单数", dataIndex: "order_count" },
          ]}
        />
      </Card>
    </Space>
  );
}
