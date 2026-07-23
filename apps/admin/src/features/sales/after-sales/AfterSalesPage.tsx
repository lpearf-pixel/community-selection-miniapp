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
import {
  addAfterSaleNote,
  linkAfterSaleLoss,
  loadAfterSales,
  resolveAfterSale,
  reviewAfterSale,
} from "./api";
import type { AfterSaleCase } from "./types";

export type AfterSalesPageProps = {
  refreshVersion: number;
  defaultLossProductId?: string;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function AfterSalesPage(props: AfterSalesPageProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<AfterSaleCase[]>,
    initialFeatureResourceState<AfterSaleCase[]>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "started" });
    void loadAfterSales(undefined, controller.signal).then(
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

  const review = async (
    item: AfterSaleCase,
    status: "approved" | "rejected" | "reviewing",
  ) => {
    const refundText =
      status === "approved"
        ? window.prompt(
            "请输入审核通过退款金额（分，可留空）",
            String(item.requested_refund_cents ?? 0),
          )
        : null;
    const responsibility =
      status === "approved"
        ? window.prompt(
            "请输入责任方：supplier / platform / leader / customer / unknown",
            item.responsibility ?? "supplier",
          )
        : item.responsibility;
    const adminNote =
      window.prompt(
        "请输入售后审核备注",
        status === "rejected" ? "售后审核拒绝" : "售后审核处理",
      ) ?? "";
    await reviewAfterSale(item.id, {
      status,
      approved_refund_cents:
        refundText === null ? undefined : Number(refundText),
      resolution_type: status === "approved" ? "partial_refund" : "reject",
      responsibility,
      admin_note: adminNote,
    });
    props.onMessage("售后审核已保存");
    props.onMutationCommitted();
  };

  const resolve = async (item: AfterSaleCase) => {
    const resolutionType = window.prompt(
      "请输入处理结果：refund / partial_refund / resend / compensation_note / reject / manual_note",
      item.resolution_type ?? "partial_refund",
    );
    if (!resolutionType) return;
    const refundText =
      resolutionType === "refund" || resolutionType === "partial_refund"
        ? window.prompt(
            "请输入确认退款金额（分）",
            String(
              item.approved_refund_cents ?? item.requested_refund_cents ?? 0,
            ),
          )
        : null;
    const adminNote =
      window.prompt("请输入售后解决备注", "售后客服人工处理") ?? "";
    await resolveAfterSale(item.id, {
      resolution_type: resolutionType,
      approved_refund_cents:
        refundText === null ? undefined : Number(refundText),
      admin_note: adminNote,
    });
    props.onMessage("售后处理已完成");
    props.onMutationCommitted();
  };

  const addNote = async (item: AfterSaleCase) => {
    const note = window.prompt("请输入售后备注", "售后客服补充备注");
    if (!note) return;
    await addAfterSaleNote(item.id, note);
    props.onMessage("售后备注已追加");
    props.onMutationCommitted();
  };

  const linkLoss = async (item: AfterSaleCase) => {
    const productId = window.prompt(
      "请输入损耗商品 ID",
      item.product_id ?? props.defaultLossProductId ?? "",
    );
    if (!productId) return;
    const batchId = window.prompt("请输入批次 ID（可留空）", "") ?? "";
    const quantityText = window.prompt("请输入损耗数量（基础库存单位）", "1");
    if (!quantityText) return;
    const remark = window.prompt("请输入损耗备注", "售后问题关联损耗") ?? "";
    await linkAfterSaleLoss(item.id, {
      product_id: productId,
      batch_id: batchId || undefined,
      quantity: Number(quantityText),
      reason: `after_sale_${item.type}`,
      remark,
    });
    props.onMessage("售后损耗已关联");
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="售后客服加载失败"
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
        {state.status !== "error" ? <Spin tip="正在加载售后客服" /> : null}
      </Space>
    );
  }

  const afterSales = state.data;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorAlert}
      {state.status === "refreshing" ? (
        <Typography.Text type="secondary">正在刷新售后客服…</Typography.Text>
      ) : null}
      <Card title="售后客服">
        <Table
          rowKey="id"
          dataSource={afterSales}
          columns={[
            { title: "售后单", dataIndex: "id" },
            {
              title: "订单号",
              render: (_: unknown, item: AfterSaleCase) =>
                item.order?.order_no ?? item.order_id,
            },
            {
              title: "用户",
              render: (_: unknown, item: AfterSaleCase) =>
                item.order?.user?.nickname ?? item.user_id ?? "-",
            },
            {
              title: "商品",
              render: (_: unknown, item: AfterSaleCase) =>
                item.product?.name ?? item.product_id ?? "-",
            },
            { title: "类型", dataIndex: "type" },
            { title: "状态", dataIndex: "status" },
            {
              title: "责任方",
              render: (_: unknown, item: AfterSaleCase) =>
                item.responsibility ?? "-",
            },
            {
              title: "申请退款",
              render: (_: unknown, item: AfterSaleCase) =>
                `¥${formatYuan(item.requested_refund_cents ?? 0)}`,
            },
            {
              title: "审核退款",
              render: (_: unknown, item: AfterSaleCase) =>
                `¥${formatYuan(item.approved_refund_cents ?? 0)}`,
            },
            { title: "原因", dataIndex: "reason" },
            {
              title: "证据 URL",
              render: (_: unknown, item: AfterSaleCase) =>
                (item.evidence_image_urls ?? []).join("；") || "-",
            },
            {
              title: "创建时间",
              render: (_: unknown, item: AfterSaleCase) =>
                new Date(item.created_at).toLocaleString(),
            },
            {
              title: "操作",
              render: (_: unknown, item: AfterSaleCase) => (
                <Space>
                  <Button onClick={() => review(item, "approved")}>
                    审核通过
                  </Button>
                  <Button onClick={() => review(item, "rejected")}>
                    审核拒绝
                  </Button>
                  <Button onClick={() => resolve(item)}>解决</Button>
                  <Button onClick={() => addNote(item)}>追加备注</Button>
                  <Button onClick={() => linkLoss(item)}>关联损耗</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
