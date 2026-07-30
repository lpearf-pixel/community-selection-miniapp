import { useEffect, useMemo, useReducer, useState } from 'react';
import { Alert, Button, Space, Spin, Typography } from 'antd';
import {
  featureErrorMessage,
  initialFeatureResourceState,
} from '../../../shared/state/feature-resource';
import { ProductCompliancePanel } from '../compliance/ProductCompliancePanel';
import { loadCatalogProducts } from './api';
import { CatalogProductForm } from './CatalogProductForm';
import { CatalogProductsTable } from './CatalogProductsTable';
import {
  catalogCategoryOptions,
  reduceCatalogProductsResource,
} from './page-model';
import { EMPTY_PRODUCT, type CatalogProductsData, type Product } from './types';

export type CatalogProductsPageProps = {
  refreshVersion: number;
};

export function CatalogProductsPage(props: CatalogProductsPageProps) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [editingProduct, setEditingProduct] = useState<Product>(EMPTY_PRODUCT);
  const [message, setMessage] = useState('');
  const [state, dispatch] = useReducer(
    reduceCatalogProductsResource,
    initialFeatureResourceState<CatalogProductsData>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'started' });
    void loadCatalogProducts(undefined, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'resolved', data });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          dispatch({
            type: 'rejected',
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
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? <Spin tip="正在加载商品目录" /> : null}
      </Space>
    );
  }

  const startCreate = () => {
    setEditingProduct(EMPTY_PRODUCT);
    setMessage('正在新增商品，保存接口将在后续阶段接入。');
  };
  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setMessage('正在编辑商品，保存接口将在后续阶段接入。');
  };
  const toggleStatus = (product: Product) => {
    dispatch({ type: 'product-status-toggled', productId: product.id });
    setMessage('已在页面临时切换上下架状态，持久化接口将在后续阶段接入。');
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新商品目录…</Typography.Text>
      ) : null}
      {message ? (
        <Typography.Text type="secondary">{message}</Typography.Text>
      ) : null}
      <CatalogProductsTable
        products={state.data.products}
        onCreate={startCreate}
        onEdit={startEdit}
        onToggleStatus={toggleStatus}
      />
      <CatalogProductForm
        product={editingProduct}
        categoryOptions={categoryOptions}
        onProductChange={(patch) =>
          setEditingProduct({ ...editingProduct, ...patch })
        }
        onSave={() =>
          setMessage('保存接口将在后续阶段接入，当前仅完成 L3 基础页面。')
        }
      />
      {editingProduct.id ? (
        <ProductCompliancePanel
          productId={editingProduct.id}
          onMessage={setMessage}
        />
      ) : null}
    </Space>
  );
}
