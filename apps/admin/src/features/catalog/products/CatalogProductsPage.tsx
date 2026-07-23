import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Typography,
} from "antd";
import { formatYuan } from "@community-selection/shared";
import {
  featureErrorMessage,
  initialFeatureResourceState,
} from "../../../shared/state/feature-resource";
import { loadCatalogProducts } from "./api";
import {
  catalogCategoryOptions,
  reduceCatalogProductsResource,
} from "./page-model";
import {
  EMPTY_PRODUCT,
  type CatalogProductsData,
  type CommissionType,
  type Product,
} from "./types";

export type CatalogProductsPageProps = {
  refreshVersion: number;
};

export function CatalogProductsPage(props: CatalogProductsPageProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [editingProduct, setEditingProduct] = useState<Product>(EMPTY_PRODUCT);
  const [message, setMessage] = useState("");
  const [state, dispatch] = useReducer(
    reduceCatalogProductsResource,
    initialFeatureResourceState<CatalogProductsData>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "started" });
    void loadCatalogProducts(undefined, controller.signal).then(
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

  const categoryOptions = useMemo(
    () => catalogCategoryOptions(state.data?.categories ?? []),
    [state.data?.categories],
  );

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="商品目录加载失败"
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
        {state.status !== "error" ? (
          <Spin tip="正在加载商品目录" />
        ) : null}
      </Space>
    );
  }

  const data = state.data;

  const startCreate = () => {
    setEditingProduct(EMPTY_PRODUCT);
    setMessage("正在新增商品，保存接口将在后续阶段接入。");
  };

  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setMessage("正在编辑商品，保存接口将在后续阶段接入。");
  };

  const toggleStatus = (product: Product) => {
    dispatch({
      type: "product-status-toggled",
      productId: product.id,
    });
    setMessage(
      "已在页面临时切换上下架状态，持久化接口将在后续阶段接入。",
    );
  };

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {errorAlert}
      {state.status === "refreshing" ? (
        <Typography.Text type="secondary">正在刷新商品目录…</Typography.Text>
      ) : null}
      {message ? (
        <Typography.Text type="secondary">{message}</Typography.Text>
      ) : null}
      <Card
        title="商品列表"
        extra={<Button onClick={startCreate}>新增商品</Button>}
      >
        <Table
          rowKey="id"
          dataSource={data.products}
          columns={[
            { title: "商品名称", dataIndex: "name" },
            {
              title: "分类",
              render: (_: unknown, product: Product) =>
                product.category?.name ?? "-",
            },
            {
              title: "售价",
              render: (_: unknown, product: Product) =>
                `¥${formatYuan(product.price_cents)}`,
            },
            {
              title: "库存",
              render: (_: unknown, product: Product) =>
                `${product.stock} ${product.stock_unit ?? product.unit}`,
            },
            {
              title: "销售规格",
              render: (_: unknown, product: Product) =>
                product.sale_spec_name ?? "-",
            },
            {
              title: "销售单位",
              render: (_: unknown, product: Product) =>
                product.sale_unit ?? product.unit,
            },
            {
              title: "每份扣减",
              render: (_: unknown, product: Product) =>
                `${product.stock_deduct_quantity ?? 1} ${product.stock_unit ?? product.unit}`,
            },
            {
              title: "支持开团",
              render: (_: unknown, product: Product) =>
                product.is_group_enabled ? "是" : "否",
            },
            {
              title: "开团服务奖励",
              render: (_: unknown, product: Product) =>
                product.commission_type === "fixed"
                  ? `固定 ¥${formatYuan(product.commission_value)}`
                  : product.commission_type === "percent"
                    ? `${product.commission_value}%`
                    : "无",
            },
            { title: "状态", dataIndex: "status" },
            {
              title: "操作",
              render: (_: unknown, product: Product) => (
                <Space>
                  <Button onClick={() => startEdit(product)}>编辑</Button>
                  <Button onClick={() => toggleStatus(product)}>
                    {product.status === "active" ? "下架" : "上架"}
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card title={editingProduct.id ? "编辑商品" : "新增商品"}>
        <Form layout="vertical">
          <Form.Item label="商品名称">
            <Input
              aria-label="商品名称"
              value={editingProduct.name}
              onChange={(event: { target: { value: string } }) =>
                setEditingProduct({
                  ...editingProduct,
                  name: event.target.value,
                })
              }
            />
          </Form.Item>
          <Form.Item label="分类">
            <Select
              value={editingProduct.category_id}
              options={categoryOptions}
              onChange={(value: string) =>
                setEditingProduct({
                  ...editingProduct,
                  category_id: value,
                })
              }
            />
          </Form.Item>
          <Form.Item label="售价（元）">
            <InputNumber
              value={editingProduct.price_cents / 100}
              min={0}
              onChange={(value: number | null) =>
                setEditingProduct({
                  ...editingProduct,
                  price_cents: Math.round((value ?? 0) * 100),
                })
              }
            />
          </Form.Item>
          <Form.Item label="库存（基础库存单位数量）">
            <InputNumber
              value={editingProduct.stock}
              min={0}
              onChange={(value: number | null) =>
                setEditingProduct({
                  ...editingProduct,
                  stock: value ?? 0,
                })
              }
            />
          </Form.Item>
          <Form.Item label="库存基础单位">
            <Input
              value={editingProduct.stock_unit}
              onChange={(event: { target: { value: string } }) =>
                setEditingProduct({
                  ...editingProduct,
                  stock_unit: event.target.value,
                })
              }
            />
          </Form.Item>
          <Form.Item label="销售单位">
            <Input
              value={editingProduct.sale_unit}
              onChange={(event: { target: { value: string } }) =>
                setEditingProduct({
                  ...editingProduct,
                  sale_unit: event.target.value,
                })
              }
            />
          </Form.Item>
          <Form.Item label="销售规格">
            <Input
              value={editingProduct.sale_spec_name ?? ""}
              onChange={(event: { target: { value: string } }) =>
                setEditingProduct({
                  ...editingProduct,
                  sale_spec_name: event.target.value,
                })
              }
            />
          </Form.Item>
          <Form.Item label="每销售单位扣减库存基础单位数量">
            <InputNumber
              value={editingProduct.stock_deduct_quantity}
              min={1}
              onChange={(value: number | null) =>
                setEditingProduct({
                  ...editingProduct,
                  stock_deduct_quantity: value ?? 1,
                })
              }
            />
          </Form.Item>
          <Form.Item label="支持开团">
            <Switch
              checked={editingProduct.is_group_enabled}
              onChange={(checked: boolean) =>
                setEditingProduct({
                  ...editingProduct,
                  is_group_enabled: checked,
                })
              }
            />
          </Form.Item>
          <Form.Item label="开团服务奖励类型">
            <Select
              value={editingProduct.commission_type}
              options={[
                { label: "无", value: "none" },
                { label: "固定金额", value: "fixed" },
                { label: "百分比", value: "percent" },
              ]}
              onChange={(value: CommissionType) =>
                setEditingProduct({
                  ...editingProduct,
                  commission_type: value,
                })
              }
            />
          </Form.Item>
          <Form.Item label="开团服务奖励值（固定金额用元，百分比用整数）">
            <InputNumber
              value={
                editingProduct.commission_type === "fixed"
                  ? editingProduct.commission_value / 100
                  : editingProduct.commission_value
              }
              min={0}
              onChange={(value: number | null) =>
                setEditingProduct({
                  ...editingProduct,
                  commission_value:
                    editingProduct.commission_type === "fixed"
                      ? Math.round((value ?? 0) * 100)
                      : (value ?? 0),
                })
              }
            />
          </Form.Item>
          <Button
            onClick={() =>
              setMessage("保存接口将在后续阶段接入，当前仅完成 L3 基础页面。")
            }
          >
            保存
          </Button>
        </Form>
      </Card>
    </Space>
  );
}
