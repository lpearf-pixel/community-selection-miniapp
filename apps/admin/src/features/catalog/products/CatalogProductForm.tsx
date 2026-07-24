import { Button, Card, Form, Input, InputNumber, Select, Switch } from 'antd';
import type { CommissionType, Product } from './types';

export type CatalogProductFormProps = {
  product: Product;
  categoryOptions: Array<{ label: string; value: string }>;
  onProductChange: (patch: Partial<Product>) => void;
  onSave: () => void;
};

export function CatalogProductForm(props: CatalogProductFormProps) {
  const product = props.product;

  return (
    <Card title={product.id ? '编辑商品' : '新增商品'}>
      <Form layout="vertical">
        <Form.Item label="商品名称">
          <Input
            aria-label="商品名称"
            value={product.name}
            onChange={(event: { target: { value: string } }) =>
              props.onProductChange({ name: event.target.value })
            }
          />
        </Form.Item>
        <Form.Item label="分类">
          <Select
            value={product.category_id}
            options={props.categoryOptions}
            onChange={(value: string) =>
              props.onProductChange({ category_id: value })
            }
          />
        </Form.Item>
        <Form.Item label="售价（元）">
          <InputNumber
            value={product.price_cents / 100}
            min={0}
            onChange={(value: number | null) =>
              props.onProductChange({
                price_cents: Math.round((value ?? 0) * 100),
              })
            }
          />
        </Form.Item>
        <Form.Item label="库存（基础库存单位数量）">
          <InputNumber
            value={product.stock}
            min={0}
            onChange={(value: number | null) =>
              props.onProductChange({ stock: value ?? 0 })
            }
          />
        </Form.Item>
        <Form.Item label="库存基础单位">
          <Input
            value={product.stock_unit}
            onChange={(event: { target: { value: string } }) =>
              props.onProductChange({ stock_unit: event.target.value })
            }
          />
        </Form.Item>
        <Form.Item label="销售单位">
          <Input
            value={product.sale_unit}
            onChange={(event: { target: { value: string } }) =>
              props.onProductChange({ sale_unit: event.target.value })
            }
          />
        </Form.Item>
        <Form.Item label="销售规格">
          <Input
            value={product.sale_spec_name ?? ''}
            onChange={(event: { target: { value: string } }) =>
              props.onProductChange({ sale_spec_name: event.target.value })
            }
          />
        </Form.Item>
        <Form.Item label="每销售单位扣减库存基础单位数量">
          <InputNumber
            value={product.stock_deduct_quantity}
            min={1}
            onChange={(value: number | null) =>
              props.onProductChange({ stock_deduct_quantity: value ?? 1 })
            }
          />
        </Form.Item>
        <Form.Item label="支持开团">
          <Switch
            checked={product.is_group_enabled}
            onChange={(checked: boolean) =>
              props.onProductChange({ is_group_enabled: checked })
            }
          />
        </Form.Item>
        <Form.Item label="开团服务奖励类型">
          <Select
            value={product.commission_type}
            options={[
              { label: '无', value: 'none' },
              { label: '固定金额', value: 'fixed' },
              { label: '百分比', value: 'percent' },
            ]}
            onChange={(value: CommissionType) =>
              props.onProductChange({ commission_type: value })
            }
          />
        </Form.Item>
        <Form.Item label="开团服务奖励值（固定金额用元，百分比用整数）">
          <InputNumber
            value={
              product.commission_type === 'fixed'
                ? product.commission_value / 100
                : product.commission_value
            }
            min={0}
            onChange={(value: number | null) =>
              props.onProductChange({
                commission_value:
                  product.commission_type === 'fixed'
                    ? Math.round((value ?? 0) * 100)
                    : (value ?? 0),
              })
            }
          />
        </Form.Item>
        <Button onClick={props.onSave}>保存</Button>
      </Form>
    </Card>
  );
}
