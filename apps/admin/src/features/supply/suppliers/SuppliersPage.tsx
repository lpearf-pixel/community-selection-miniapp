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
import type { Supplier } from '../../inventory/shared/types';
import {
  createSupplier,
  disableSupplier,
  loadSuppliers,
} from './api';

const loadSupplierResource = (signal: AbortSignal) =>
  loadSuppliers(undefined, signal);

export type SuppliersPageProps = {
  refreshVersion: number;
  onMessage: (message: string) => void;
  onMutationCommitted: () => void;
};

export function SuppliersPage(props: SuppliersPageProps) {
  const { state, retry } = useFeatureResourceLoader<Supplier[]>(
    loadSupplierResource,
    props.refreshVersion,
  );

  const create = async () => {
    const name = window.prompt('请输入供应商名称');
    if (!name) return;
    const contactName = window.prompt('请输入联系人', '') ?? '';
    const contactPhone = window.prompt('请输入联系电话', '') ?? '';
    const remark = window.prompt('请输入备注', '') ?? '';

    await createSupplier({
      name,
      contact_name: contactName,
      contact_phone: contactPhone,
      remark,
    });
    props.onMessage('供应商已创建');
    props.onMutationCommitted();
  };

  const disable = async (supplier: Supplier) => {
    await disableSupplier(supplier.id);
    props.onMessage('供应商已禁用');
    props.onMutationCommitted();
  };

  const errorAlert = state.error ? (
    <Alert
      type="error"
      showIcon
      message="供应商管理加载失败"
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
        {state.status !== 'error' ? <Spin tip="正在加载供应商管理" /> : null}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {errorAlert}
      {state.status === 'refreshing' ? (
        <Typography.Text type="secondary">
          正在刷新供应商管理…
        </Typography.Text>
      ) : null}
      <Card
        title="供应商管理"
        extra={<Button onClick={create}>新增供应商</Button>}
      >
        <Table
          rowKey="id"
          dataSource={state.data}
          columns={[
            { title: '供应商', dataIndex: 'name' },
            { title: '联系人', dataIndex: 'contact_name' },
            { title: '电话', dataIndex: 'contact_phone' },
            { title: '状态', dataIndex: 'status' },
            { title: '备注', dataIndex: 'remark' },
            {
              title: '操作',
              render: (_: unknown, supplier: Supplier) => (
                <Button onClick={() => disable(supplier)}>禁用</Button>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
}
