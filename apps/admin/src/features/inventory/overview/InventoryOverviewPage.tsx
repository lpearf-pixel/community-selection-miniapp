import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import { settleLatestFeatureRequest } from '../../../shared/state/latest-feature-request';
import { createPurchasePlan } from '../../supply/purchase-plans/api';
import { collectPurchasePlanInput } from '../../supply/purchase-plans/prompt-model';
import {
  adjustInventory,
  loadInventoryOverview,
  loadStockLedger,
} from './api';
import { commitInventoryAdjustment } from './inventory-adjust-mutation';
import type {
  InventoryItem,
  InventoryOverview,
  InventoryProductReference,
  StockLedger,
} from '../shared/types';

const loadInventoryResource = (signal: AbortSignal) =>
  loadInventoryOverview(undefined, signal);

export type InventoryOverviewPageProps = {
  refreshVersion: number;
  onDefaultProductReference: (
    reference: InventoryProductReference | null,
  ) => void;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

function toInventoryProductReference(
  item: InventoryItem,
): InventoryProductReference {
  return {
    product_id: item.product_id,
    product_name: item.product_name,
    stock_unit: item.stock_unit,
    suggest_purchase_quantity: item.suggest_purchase_quantity,
    stock_deduct_quantity: item.stock_deduct_quantity,
  };
}

export function InventoryOverviewPage(
  props: InventoryOverviewPageProps,
) {
  const { state, retry } = useFeatureResourceLoader<InventoryOverview>(
    loadInventoryResource,
    props.refreshVersion,
  );
  const [stockLedgers, setStockLedgers] = useState<StockLedger[]>([]);
  const [adjustingProductIds, setAdjustingProductIds] = useState<Set<string>>(
    () => new Set(),
  );
  const adjustingProductIdsRef = useRef(new Set<string>());
  const ledgerRequestGenerationRef = useRef(0);
  const activeLedgerRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const firstItem = state.data?.items[0];
    props.onDefaultProductReference(
      firstItem ? toInventoryProductReference(firstItem) : null,
    );
  }, [props.onDefaultProductReference, state.data]);

  useEffect(
    () => () => {
      ledgerRequestGenerationRef.current += 1;
      activeLedgerRequestRef.current?.abort();
      activeLedgerRequestRef.current = null;
    },
    [],
  );

  const loadProductLedger = async (item: InventoryItem) => {
    activeLedgerRequestRef.current?.abort();
    const controller = new AbortController();
    const generation = ledgerRequestGenerationRef.current + 1;
    ledgerRequestGenerationRef.current = generation;
    activeLedgerRequestRef.current = controller;

    try {
      const result = await settleLatestFeatureRequest(
        {
          controller,
          generation,
          isCurrent: () =>
            !controller.signal.aborted &&
            ledgerRequestGenerationRef.current === generation,
        },
        (signal) =>
          loadStockLedger(
            item.product_id,
            undefined,
            signal,
          ),
      );
      if (result.discarded) return;
      setStockLedgers(result.data);
      props.onMessage(`已加载 ${item.product_name} 库存流水`);
    } finally {
      if (ledgerRequestGenerationRef.current === generation) {
        activeLedgerRequestRef.current = null;
      }
    }
  };

  const adjust = async (item: InventoryItem) => {
    if (adjustingProductIdsRef.current.has(item.product_id)) return;
    const adjustText = window.prompt(
      `请输入 ${item.product_name} 调整数量（基础库存单位：${item.stock_unit}，可为负数）`,
      '1',
    );
    if (!adjustText) return;
    const reason = window.prompt('请输入库存调整原因', '后台人工调整');
    if (!reason) return;

    adjustingProductIdsRef.current.add(item.product_id);
    setAdjustingProductIds(new Set(adjustingProductIdsRef.current));
    try {
      await commitInventoryAdjustment({
        item,
        adjust_quantity: Number(adjustText),
        reason,
        adjust: adjustInventory,
        onMessage: props.onMessage,
        onMutationCommitted: props.onMutationCommitted,
      });
    } finally {
      adjustingProductIdsRef.current.delete(item.product_id);
      setAdjustingProductIds(new Set(adjustingProductIdsRef.current));
    }
  };

  const createPlan = async (item?: InventoryItem) => {
    const target = item
      ? toInventoryProductReference(item)
      : state.data?.items[0]
        ? toInventoryProductReference(state.data.items[0])
        : null;
    if (!target) {
      props.onMessage('暂无商品可创建采购计划');
      return;
    }
    const input = collectPurchasePlanInput(target, window.prompt);
    if (!input) return;

    await createPurchasePlan(input);
    props.onMessage('采购计划已创建');
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="库存管理加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载库存管理" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新库存管理…</Typography.Text>
      ) : null}
      <Card
        title="库存管理"
        extra={
          <Button onClick={() => createPlan()}>
            按首个商品创建采购计划
          </Button>
        }
      >
        <Typography.Paragraph>
          SKU：{state.data.total_sku_count}；低库存：
          {state.data.low_stock_count}；缺货：
          {state.data.out_of_stock_count}
        </Typography.Paragraph>
        <Table
          rowKey="product_id"
          dataSource={state.data.items}
          columns={[
            { title: '商品名', dataIndex: 'product_name' },
            {
              title: '当前库存',
              render: (_: unknown, item: InventoryItem) =>
                item.display_stock,
            },
            {
              title: '销售规格',
              render: (_: unknown, item: InventoryItem) =>
                item.sale_spec_name ?? '-',
            },
            { title: '销售单位', dataIndex: 'sale_unit' },
            {
              title: '每份扣减',
              render: (_: unknown, item: InventoryItem) =>
                `${item.stock_deduct_quantity} ${item.stock_unit}`,
            },
            { title: '状态', dataIndex: 'status' },
            {
              title: '低库存阈值',
              render: (_: unknown, item: InventoryItem) =>
                `${item.low_stock_threshold} ${item.stock_unit}`,
            },
            {
              title: '建议采购量',
              render: (_: unknown, item: InventoryItem) =>
                `${item.suggest_purchase_quantity} ${item.stock_unit}`,
            },
            {
              title: '操作',
              render: (_: unknown, item: InventoryItem) => (
                <Space>
                  <Button onClick={() => loadProductLedger(item)}>
                    查看流水
                  </Button>
                  <Button
                    disabled={adjustingProductIds.has(item.product_id)}
                    loading={adjustingProductIds.has(item.product_id)}
                    onClick={() => adjust(item)}
                  >
                    库存调整
                  </Button>
                  <Button onClick={() => createPlan(item)}>
                    创建采购计划
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        {stockLedgers.length ? (
          <Table
            rowKey="id"
            dataSource={stockLedgers}
            pagination={{ pageSize: 5 }}
            columns={[
              { title: '类型', dataIndex: 'source_type' },
              { title: '方向', dataIndex: 'direction' },
              { title: '数量', dataIndex: 'quantity' },
              { title: '调整前', dataIndex: 'stock_before' },
              { title: '调整后', dataIndex: 'stock_after' },
              { title: '备注', dataIndex: 'remark' },
            ]}
          />
        ) : null}
      </Card>
    </Space>
  );
}
