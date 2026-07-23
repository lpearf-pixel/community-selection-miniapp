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
import {
  loadBatchLedger,
  loadInventoryBatches,
  recordBatchLoss,
} from './api';
import type {
  BatchStockLedger,
  ProductBatch,
} from '../shared/types';

const loadBatchResource = (signal: AbortSignal) =>
  loadInventoryBatches(undefined, signal);

export type InventoryBatchesPageProps = {
  refreshVersion: number;
  onDefaultBatchId: (batchId: string) => void;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function InventoryBatchesPage(
  props: InventoryBatchesPageProps,
) {
  const { state, retry } = useFeatureResourceLoader<ProductBatch[]>(
    loadBatchResource,
    props.refreshVersion,
  );
  const [batchLedgers, setBatchLedgers] = useState<BatchStockLedger[]>([]);
  const ledgerRequestGenerationRef = useRef(0);
  const activeLedgerRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    props.onDefaultBatchId(state.data?.[0]?.id ?? '');
  }, [props.onDefaultBatchId, state.data]);

  useEffect(
    () => () => {
      ledgerRequestGenerationRef.current += 1;
      activeLedgerRequestRef.current?.abort();
      activeLedgerRequestRef.current = null;
    },
    [],
  );

  const loadLedger = async (batch: ProductBatch) => {
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
          loadBatchLedger(
            batch.id,
            undefined,
            signal,
          ),
      );
      if (result.discarded) return;
      setBatchLedgers(result.data);
      props.onMessage(`已加载批次 ${batch.batch_no} 流水`);
    } finally {
      if (ledgerRequestGenerationRef.current === generation) {
        activeLedgerRequestRef.current = null;
      }
    }
  };

  const recordLoss = async (batch: ProductBatch) => {
    const quantityText = window.prompt(
      `请输入损耗数量（${batch.stock_unit}）`,
      '1',
    );
    if (!quantityText) return;
    const lossType = window.prompt(
      '请输入损耗类型：damaged / expired / weight_loss / bad_fruit / manual_loss / other',
      'bad_fruit',
    );
    if (!lossType) return;
    const reason = window.prompt('请输入损耗原因', '坏果损耗');
    if (!reason) return;

    await recordBatchLoss(batch.id, {
      quantity: Number(quantityText),
      loss_type: lossType,
      reason,
      responsible_type: 'supplier',
    });
    props.onMessage('损耗已记录');
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="批次库存加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载批次库存" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新批次库存…</Typography.Text>
      ) : null}
      <Card title="批次库存">
        <Table
          rowKey="id"
          dataSource={state.data}
          columns={[
            { title: '批次号', dataIndex: 'batch_no' },
            { title: '商品', dataIndex: 'product_name_snapshot' },
            { title: '供应商', dataIndex: 'supplier_name_snapshot' },
            {
              title: '剩余数量',
              render: (_: unknown, batch: ProductBatch) =>
                `${batch.remaining_quantity} ${batch.stock_unit}`,
            },
            {
              title: '到货日期',
              render: (_: unknown, batch: ProductBatch) =>
                new Date(batch.arrival_date).toLocaleDateString(),
            },
            {
              title: '过期日期',
              render: (_: unknown, batch: ProductBatch) =>
                batch.expire_at
                  ? new Date(batch.expire_at).toLocaleDateString()
                  : '-',
            },
            {
              title: '状态',
              render: (_: unknown, batch: ProductBatch) =>
                batch.status_hint ?? batch.status,
            },
            {
              title: '操作',
              render: (_: unknown, batch: ProductBatch) => (
                <Space>
                  <Button onClick={() => recordLoss(batch)}>记录损耗</Button>
                  <Button onClick={() => loadLedger(batch)}>
                    查看批次流水
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        {batchLedgers.length ? (
          <Table
            rowKey="id"
            dataSource={batchLedgers}
            pagination={{ pageSize: 5 }}
            columns={[
              { title: '类型', dataIndex: 'source_type' },
              { title: '方向', dataIndex: 'direction' },
              { title: '数量', dataIndex: 'quantity' },
              { title: '批次调整前', dataIndex: 'batch_quantity_before' },
              { title: '批次调整后', dataIndex: 'batch_quantity_after' },
              { title: '备注', dataIndex: 'remark' },
            ]}
          />
        ) : null}
      </Card>
    </Space>
  );
}
