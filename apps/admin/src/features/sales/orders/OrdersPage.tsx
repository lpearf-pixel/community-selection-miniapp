import { useEffect, useReducer, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Space,
  Spin,
  Typography,
} from 'antd';
import { AdminApiError } from '../../../shared/api/errors';
import {
  featureErrorMessage,
  initialFeatureResourceState,
  reduceFeatureResource,
} from '../../../shared/state/feature-resource';
import {
  getPickingExportUrl,
  loadOrderAiContext,
  loadOrders,
  updateOrderStatus,
  verifyOrderPickup,
} from './api';
import { OrderDetailsCard } from './OrderDetailsCard';
import { OrdersFilters } from './OrdersFilters';
import { OrdersTable } from './OrdersTable';
import {
  applyOrderFilters,
  changeOrderPage,
  DEFAULT_ADMIN_ORDER_QUERY,
} from './page-model';
import type { AdminOrderFilters } from './page-model';
import type {
  AdminOrderListItem,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AiContext,
} from './types';

export type OrdersPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function OrdersPage(props: OrdersPageProps) {
  const [form] = Form.useForm<AdminOrderFilters>();
  const [query, setQuery] = useState<AdminOrderListQuery>(
    DEFAULT_ADMIN_ORDER_QUERY,
  );
  const [retryVersion, setRetryVersion] = useState(0);
  const [selectedOrderContext, setSelectedOrderContext] =
    useState<AiContext | null>(null);
  const [state, dispatch] = useReducer(
    reduceFeatureResource<AdminOrderListResponse>,
    initialFeatureResourceState<AdminOrderListResponse>(),
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'started' });
    void loadOrders(query, undefined, controller.signal).then(
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
  }, [props.refreshVersion, query, retryVersion]);

  const loadOrderContext = async (order: AdminOrderListItem) => {
    const context = await loadOrderAiContext(order.id);
    setSelectedOrderContext(context);
    props.onMessage(`已加载订单 ${order.order_no} 全链路详情`);
  };

  const pickupVerify = async (order: AdminOrderListItem) => {
    await verifyOrderPickup(order.id, '后台核销自提');
    props.onMessage(`订单 ${order.order_no} 已核销自提`);
    props.onMutationCommitted();
  };

  const markOrder = async (
    order: AdminOrderListItem,
    nextStatus: string,
  ) => {
    try {
      await updateOrderStatus(
        order.id,
        nextStatus,
        order.version,
        crypto.randomUUID(),
      );
      props.onMessage(`订单 ${order.order_no} 已更新为 ${nextStatus}`);
      props.onMutationCommitted();
    } catch (error) {
      if (
        error instanceof AdminApiError &&
        error.code === 'ADMIN_ORDER_VERSION_CONFLICT'
      ) {
        props.onMessage('订单已被其他操作更新，已刷新列表，请重试');
        setRetryVersion((value) => value + 1);
        return;
      }
      throw error;
    }
  };

  const resetFilters = () => {
    form.resetFields();
    setQuery(DEFAULT_ADMIN_ORDER_QUERY);
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
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {errorAlert}
        {state.status !== 'error' ? (
          <Spin tip="正在加载订单列表" />
        ) : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新订单列表…
        </Typography.Text>
      ) : null}
      <Card
        title="全渠道订单"
        extra={
          <Space wrap>
            <Button
              onClick={() => {
                window.location.href = getPickingExportUrl('detail');
              }}
            >
              导出明细分拣单 CSV
            </Button>
            <Button
              onClick={() => {
                window.location.href = getPickingExportUrl('summary');
              }}
            >
              导出汇总分拣单 CSV
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            当前历史订单统一标记为“微信小程序”，渠道信息仅用于只读展示。
          </Typography.Text>
          <OrdersFilters
            form={form}
            onFinish={(filters) =>
              setQuery((current) => applyOrderFilters(current, filters))
            }
            onReset={resetFilters}
          />
          <OrdersTable
            data={state.data}
            onPageChange={(page, pageSize) =>
              setQuery((current) =>
                changeOrderPage(current, page, pageSize),
              )
            }
            onLoadContext={loadOrderContext}
            onMarkOrder={markOrder}
            onVerifyPickup={pickupVerify}
          />
        </Space>
      </Card>
      {selectedOrderContext ? (
        <OrderDetailsCard context={selectedOrderContext} />
      ) : null}
    </Space>
  );
}
