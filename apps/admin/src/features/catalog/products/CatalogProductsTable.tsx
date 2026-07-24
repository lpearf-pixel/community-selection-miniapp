import { Button, Card, Space, Table } from 'antd';
import { formatYuan } from '@community-selection/shared';
import type { Product } from './types';

export type CatalogProductsTableProps = {
  products: Product[];
  onCreate: () => void;
  onEdit: (product: Product) => void;
  onToggleStatus: (product: Product) => void;
};

export function CatalogProductsTable(props: CatalogProductsTableProps) {
  return (
    <Card
      title="商品列表"
      extra={<Button onClick={props.onCreate}>新增商品</Button>}
    >
      <Table
        rowKey="id"
        dataSource={props.products}
        columns={[
          { title: '商品名称', dataIndex: 'name' },
          {
            title: '分类',
            render: (_: unknown, product: Product) =>
              product.category?.name ?? '-',
          },
          {
            title: '售价',
            render: (_: unknown, product: Product) =>
              `¥${formatYuan(product.price_cents)}`,
          },
          {
            title: '库存',
            render: (_: unknown, product: Product) =>
              `${product.stock} ${product.stock_unit ?? product.unit}`,
          },
          {
            title: '销售规格',
            render: (_: unknown, product: Product) =>
              product.sale_spec_name ?? '-',
          },
          {
            title: '销售单位',
            render: (_: unknown, product: Product) =>
              product.sale_unit ?? product.unit,
          },
          {
            title: '每份扣减',
            render: (_: unknown, product: Product) =>
              `${product.stock_deduct_quantity ?? 1} ${product.stock_unit ?? product.unit}`,
          },
          {
            title: '支持开团',
            render: (_: unknown, product: Product) =>
              product.is_group_enabled ? '是' : '否',
          },
          {
            title: '开团服务奖励',
            render: (_: unknown, product: Product) =>
              product.commission_type === 'fixed'
                ? `固定 ¥${formatYuan(product.commission_value)}`
                : product.commission_type === 'percent'
                  ? `${product.commission_value}%`
                  : '无',
          },
          { title: '状态', dataIndex: 'status' },
          {
            title: '操作',
            render: (_: unknown, product: Product) => (
              <Space>
                <Button onClick={() => props.onEdit(product)}>编辑</Button>
                <Button onClick={() => props.onToggleStatus(product)}>
                  {product.status === 'active' ? '下架' : '上架'}
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
