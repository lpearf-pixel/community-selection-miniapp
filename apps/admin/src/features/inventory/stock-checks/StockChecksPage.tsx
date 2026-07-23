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
import {
  confirmStockCheck,
  createStockCheck,
  loadStockChecks,
} from './api';
import { collectStockCheckInput } from './prompt-model';
import type { StockCheck } from '../shared/types';

const loadStockCheckResource = (signal: AbortSignal) =>
  loadStockChecks(undefined, signal);

export type StockChecksPageProps = {
  refreshVersion: number;
  defaultBatchId: string;
  defaultProductId: string;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function StockChecksPage(props: StockChecksPageProps) {
  const { state, retry } = useFeatureResourceLoader<StockCheck[]>(
    loadStockCheckResource,
    props.refreshVersion,
  );

  const create = async () => {
    const input = collectStockCheckInput(
      {
        defaultBatchId: props.defaultBatchId,
        defaultProductId: props.defaultProductId,
      },
      window.prompt,
    );
    if (!input) return;

    await createStockCheck(input);
    props.onMessage('盘点单已创建');
    props.onMutationCommitted();
  };

  const confirm = async (check: StockCheck) => {
    await confirmStockCheck(check.id);
    props.onMessage('盘点单已确认');
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="库存盘点加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载库存盘点" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新库存盘点…</Typography.Text>
      ) : null}
      <Card
        title="库存盘点"
        extra={<Button onClick={create}>新增盘点</Button>}
      >
        <Table
          rowKey="id"
          dataSource={state.data}
          columns={[
            { title: '盘点单号', dataIndex: 'check_no' },
            { title: '状态', dataIndex: 'status' },
            { title: '备注', dataIndex: 'remark' },
            {
              title: '明细',
              render: (_: unknown, check: StockCheck) =>
                check.items
                  .map(
                    (item) =>
                      `${item.batch_id ?? item.product_id}: ${item.book_quantity} -> ${item.actual_quantity} (${item.diff_quantity}) ${item.stock_unit}`,
                  )
                  .join('；'),
            },
            {
              title: '操作',
              render: (_: unknown, check: StockCheck) => (
                <Button onClick={() => confirm(check)}>确认</Button>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
