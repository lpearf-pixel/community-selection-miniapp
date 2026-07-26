import {
  Alert,
  Button,
  Card,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { formatYuan } from '@community-selection/shared';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import type {
  InventoryProductReference,
  PurchasePlan,
} from '../../inventory/shared/types';
import {
  cancelPurchasePlan,
  confirmPurchasePlan,
  createPurchaseReceiveCommand,
  createPurchasePlan,
  loadPurchasePlans,
  receivePurchasePlan,
} from './api';
import { collectPurchasePlanInput } from './prompt-model';

const loadPurchasePlanResource = (signal: AbortSignal) =>
  loadPurchasePlans(undefined, signal);

export type PurchasePlansPageProps = {
  refreshVersion: number;
  defaultProductReference: InventoryProductReference | null;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function PurchasePlansPage(props: PurchasePlansPageProps) {
  const { state, retry } = useFeatureResourceLoader<PurchasePlan[]>(
    loadPurchasePlanResource,
    props.refreshVersion,
  );

  const createPlan = async () => {
    if (!props.defaultProductReference) {
      props.onMessage('暂无商品可创建采购计划');
      return;
    }
    const input = collectPurchasePlanInput(
      props.defaultProductReference,
      window.prompt,
    );
    if (!input) return;

    await createPurchasePlan(input);
    props.onMessage('采购计划已创建');
    props.onMutationCommitted();
  };

  const confirm = async (plan: PurchasePlan) => {
    await confirmPurchasePlan(plan.id);
    props.onMessage('采购计划已确认');
    props.onMutationCommitted();
  };

  const cancel = async (plan: PurchasePlan) => {
    await cancelPurchasePlan(plan.id);
    props.onMessage('采购计划已取消');
    props.onMutationCommitted();
  };

  const receive = async (plan: PurchasePlan) => {
    const command = createPurchaseReceiveCommand({
      remark: '后台采购入库',
      items: plan.items.map((item) => ({
        item_id: item.id,
        received_quantity: Math.max(
          0,
          item.planned_quantity - item.received_quantity,
        ),
      })),
    });
    await receivePurchasePlan(plan.id, command);
    props.onMessage('采购入库已完成');
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="采购计划加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载采购计划" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">正在刷新采购计划…</Typography.Text>
      ) : null}
      <Card
        title="采购计划"
        extra={<Button onClick={createPlan}>新增采购计划</Button>}
      >
        <Table
          rowKey="id"
          dataSource={state.data}
          columns={[
            { title: '计划编号', dataIndex: 'plan_no' },
            {
              title: '目标日期',
              render: (_: unknown, plan: PurchasePlan) =>
                new Date(plan.target_date).toLocaleDateString(),
            },
            { title: '供应商', dataIndex: 'supplier_name' },
            { title: '状态', dataIndex: 'status' },
            { title: '总数量', dataIndex: 'total_quantity' },
            {
              title: '总金额',
              render: (_: unknown, plan: PurchasePlan) =>
                `¥${formatYuan(plan.total_amount_cents)}`,
            },
            {
              title: '明细',
              render: (_: unknown, plan: PurchasePlan) =>
                plan.items
                  .map(
                    (item) =>
                      `${item.product_name_snapshot} 采购${item.purchase_quantity ?? '-'}${item.purchase_unit ?? ''} / 入库${item.received_quantity}/${item.planned_quantity}`,
                  )
                  .join('；'),
            },
            {
              title: '操作',
              render: (_: unknown, plan: PurchasePlan) => (
                <Space>
                  <Button onClick={() => confirm(plan)}>确认</Button>
                  <Button onClick={() => cancel(plan)}>取消</Button>
                  <Button onClick={() => receive(plan)}>入库</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
