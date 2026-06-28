import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Layout, Select, Space, Switch, Table, Typography } from 'antd';
import { formatYuan } from '@community-selection/shared';

type CommissionType = 'none' | 'fixed' | 'percent';
type ProductStatus = 'draft' | 'active' | 'inactive';

type Category = {
  id: string;
  name: string;
};

type Product = {
  id: string;
  name: string;
  category_id: string;
  category?: Category;
  price_cents: number;
  cost_price_cents: number;
  stock: number;
  unit: string;
  is_group_enabled: boolean;
  commission_type: CommissionType;
  commission_value: number;
  status: ProductStatus;
};

const emptyProduct: Product = {
  id: '',
  name: '',
  category_id: '',
  price_cents: 0,
  cost_price_cents: 0,
  stock: 0,
  unit: '份',
  is_group_enabled: false,
  commission_type: 'none',
  commission_value: 0,
  status: 'draft'
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const json = await response.json();
  if (!json.success) throw new Error(json.message || '请求失败');
  return json.data as T;
}

export function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingProduct, setEditingProduct] = useState<Product>(emptyProduct);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void Promise.all([
      fetchJson<Category[]>('/api/categories'),
      fetchJson<{ items: Product[] }>('/api/products')
    ])
      .then(([categoryData, productData]) => {
        setCategories(categoryData);
        setProducts(productData.items);
      })
      .catch((error: Error) => setMessage(error.message));
  }, []);

  const categoryOptions = useMemo(
    () => categories.map((category) => ({ label: category.name, value: category.id })),
    [categories]
  );

  function startCreate() {
    setEditingProduct(emptyProduct);
    setMessage('正在新增商品，保存接口将在后续阶段接入。');
  }

  function startEdit(product: Product) {
    setEditingProduct(product);
    setMessage('正在编辑商品，保存接口将在后续阶段接入。');
  }

  function toggleStatus(product: Product) {
    const nextStatus: ProductStatus = product.status === 'active' ? 'inactive' : 'active';
    setProducts((items) => items.map((item) => (item.id === product.id ? { ...item, status: nextStatus } : item)));
    setMessage('已在页面临时切换上下架状态，持久化接口将在后续阶段接入。');
  }

  return (
    <Layout style={{ minHeight: '100vh', padding: 24 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card>
          <Typography.Title level={2}>社区甄选管理后台</Typography.Title>
          <Typography.Paragraph>
            L3 商品管理基础页：商品列表、新增、编辑、上下架、库存、是否支持开团和开团服务奖励配置。
          </Typography.Paragraph>
          {message ? <Typography.Text type="secondary">{message}</Typography.Text> : null}
        </Card>

        <Card title="商品列表" extra={<Button onClick={startCreate}>新增商品</Button>}>
          <Table
            rowKey="id"
            dataSource={products}
            columns={[
              { title: '商品名称', dataIndex: 'name' },
              { title: '分类', render: (_: unknown, product: Product) => product.category?.name ?? '-' },
              { title: '售价', render: (_: unknown, product: Product) => `¥${formatYuan(product.price_cents)}` },
              { title: '库存', dataIndex: 'stock' },
              { title: '单位', dataIndex: 'unit' },
              { title: '支持开团', render: (_: unknown, product: Product) => (product.is_group_enabled ? '是' : '否') },
              {
                title: '开团服务奖励',
                render: (_: unknown, product: Product) =>
                  product.commission_type === 'fixed'
                    ? `固定 ¥${formatYuan(product.commission_value)}`
                    : product.commission_type === 'percent'
                      ? `${product.commission_value}%`
                      : '无'
              },
              { title: '状态', dataIndex: 'status' },
              {
                title: '操作',
                render: (_: unknown, product: Product) => (
                  <Space>
                    <Button onClick={() => startEdit(product)}>编辑</Button>
                    <Button onClick={() => toggleStatus(product)}>{product.status === 'active' ? '下架' : '上架'}</Button>
                  </Space>
                )
              }
            ]}
          />
        </Card>

        <Card title={editingProduct.id ? '编辑商品' : '新增商品'}>
          <Form layout="vertical">
            <Form.Item label="商品名称">
              <Input value={editingProduct.name} onChange={(event: { target: { value: string } }) => setEditingProduct({ ...editingProduct, name: event.target.value })} />
            </Form.Item>
            <Form.Item label="分类">
              <Select value={editingProduct.category_id} options={categoryOptions} onChange={(value: string) => setEditingProduct({ ...editingProduct, category_id: value })} />
            </Form.Item>
            <Form.Item label="售价（元）">
              <InputNumber value={editingProduct.price_cents / 100} min={0} onChange={(value: number) => setEditingProduct({ ...editingProduct, price_cents: Math.round((value ?? 0) * 100) })} />
            </Form.Item>
            <Form.Item label="库存">
              <InputNumber value={editingProduct.stock} min={0} onChange={(value: number) => setEditingProduct({ ...editingProduct, stock: value ?? 0 })} />
            </Form.Item>
            <Form.Item label="支持开团">
              <Switch checked={editingProduct.is_group_enabled} onChange={(checked: boolean) => setEditingProduct({ ...editingProduct, is_group_enabled: checked })} />
            </Form.Item>
            <Form.Item label="开团服务奖励类型">
              <Select
                value={editingProduct.commission_type}
                options={[
                  { label: '无', value: 'none' },
                  { label: '固定金额', value: 'fixed' },
                  { label: '百分比', value: 'percent' }
                ]}
                onChange={(value: CommissionType) => setEditingProduct({ ...editingProduct, commission_type: value })}
              />
            </Form.Item>
            <Form.Item label="开团服务奖励值（固定金额用元，百分比用整数）">
              <InputNumber value={editingProduct.commission_type === 'fixed' ? editingProduct.commission_value / 100 : editingProduct.commission_value} min={0} onChange={(value: number) => setEditingProduct({ ...editingProduct, commission_value: editingProduct.commission_type === 'fixed' ? Math.round((value ?? 0) * 100) : value ?? 0 })} />
            </Form.Item>
            <Button onClick={() => setMessage('保存接口将在后续阶段接入，当前仅完成 L3 基础页面。')}>保存</Button>
          </Form>
        </Card>
      </Space>
    </Layout>
  );
}
