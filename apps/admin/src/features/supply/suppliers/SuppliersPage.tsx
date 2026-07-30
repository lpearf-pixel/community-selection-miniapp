import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useFeatureResourceLoader } from '../../../shared/state/use-feature-resource-loader';
import type {
  Supplier,
  SupplierComplianceState,
} from '../../inventory/shared/types';
import {
  createSupplier,
  disableSupplier,
  loadSupplierCompliance,
  loadSuppliers,
} from './api';

const SUBJECT_LABEL: Record<string, string> = {
  company: '企业',
  cooperative: '农民专业合作社',
  individual_business: '个体工商户',
  natural_person_producer: '自然人生产者',
  market_stall: '批发市场档口',
  collector: '收购商',
  temporary_source: '临时来源',
};

const loadSupplierResource = (signal: AbortSignal) =>
  loadSuppliers(undefined, signal);

function supplierSourceComplete(supplier: Supplier) {
  if (!supplier.subject_type || (supplier.profile_version ?? 0) < 1) {
    return false;
  }
  if (
    supplier.subject_type === 'natural_person_producer' ||
    supplier.subject_type === 'collector'
  ) {
    return Boolean(supplier.source_address?.trim());
  }
  if (supplier.subject_type === 'market_stall') {
    return Boolean(supplier.market_name?.trim() && supplier.stall_no?.trim());
  }
  return supplier.subject_type !== 'temporary_source';
}

export function SupplierComplianceCard(props: {
  state: SupplierComplianceState;
}) {
  return (
    <Card title={`供应商合规：${props.state.name}`}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="主体类型">
            {props.state.subject_type
              ? SUBJECT_LABEL[props.state.subject_type] ??
                props.state.subject_type
              : '未配置'}
          </Descriptions.Item>
          <Descriptions.Item label="来源档案">
            {props.state.source_complete ? '完整' : '不完整'}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            {props.state.status}
          </Descriptions.Item>
        </Descriptions>
        <Table
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={props.state.qualifications}
          columns={[
            { title: '资质类型', dataIndex: 'qualification_type' },
            { title: '版本', dataIndex: 'version' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (value: string) => <Tag>{value}</Tag>,
            },
            {
              title: '生效日',
              dataIndex: 'valid_from',
              render: (value: string | null) => value?.slice(0, 10) ?? '未设置',
            },
            {
              title: '到期日',
              dataIndex: 'expires_at',
              render: (value: string | null) => value?.slice(0, 10) ?? '长期',
            },
          ]}
        />
      </Space>
    </Card>
  );
}

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
  const [selectedCompliance, setSelectedCompliance] =
    useState<SupplierComplianceState | null>(null);
  const [complianceError, setComplianceError] = useState('');

  const create = async () => {
    const name = window.prompt('请输入供应商名称');
    if (!name) return;
    await createSupplier({
      name,
      contact_name: window.prompt('请输入联系人', '') ?? '',
      contact_phone: window.prompt('请输入联系电话', '') ?? '',
      remark: window.prompt('请输入备注', '') ?? '',
    });
    props.onMessage('供应商已创建');
    props.onMutationCommitted();
  };

  const disable = async (supplier: Supplier) => {
    await disableSupplier(supplier.id);
    props.onMessage('供应商已禁用');
    props.onMutationCommitted();
  };

  const viewCompliance = async (supplier: Supplier) => {
    setComplianceError('');
    try {
      setSelectedCompliance(await loadSupplierCompliance(supplier.id));
    } catch (cause) {
      setComplianceError(
        cause instanceof Error ? cause.message : '供应商合规状态加载失败',
      );
    }
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
      {complianceError ? (
        <Alert type="error" showIcon message={complianceError} />
      ) : null}
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
            {
              title: '主体类型',
              render: (_: unknown, supplier: Supplier) =>
                supplier.subject_type
                  ? SUBJECT_LABEL[supplier.subject_type] ??
                    supplier.subject_type
                  : '未配置',
            },
            {
              title: '来源档案',
              render: (_: unknown, supplier: Supplier) =>
                supplierSourceComplete(supplier) ? '完整' : '不完整',
            },
            { title: '联系人', dataIndex: 'contact_name' },
            { title: '电话', dataIndex: 'contact_phone' },
            { title: '状态', dataIndex: 'status' },
            { title: '备注', dataIndex: 'remark' },
            {
              title: '操作',
              render: (_: unknown, supplier: Supplier) => (
                <Space>
                  <Button onClick={() => void viewCompliance(supplier)}>
                    查看资质
                  </Button>
                  <Button onClick={() => void disable(supplier)}>禁用</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {selectedCompliance ? (
        <SupplierComplianceCard state={selectedCompliance} />
      ) : null}
    </Space>
  );
}
