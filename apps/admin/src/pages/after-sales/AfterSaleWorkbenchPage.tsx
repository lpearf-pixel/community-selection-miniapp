import { Button, Card, Input, Select, Space, Table } from 'antd';
import type { AdminAfterSale } from '../../api/adminAfterSales';

export function AfterSaleWorkbenchPage({ items, onApprove, onReject }: { items: AdminAfterSale[]; onApprove: (item: AdminAfterSale) => void; onReject: (item: AdminAfterSale) => void }) {
  return <Card title="售后审核工作台">
    <Space><Select placeholder="状态筛选" options={[{ value: 'submitted' }, { value: 'approved' }, { value: 'rejected' }]} /><Select placeholder="类型筛选" options={[{ value: 'bad_quality' }, { value: 'missing_item' }]} /><Input placeholder="订单号搜索" /></Space>
    <Table rowKey="after_sale_case_id" dataSource={items} columns={[
      { title: '订单号', dataIndex: 'order_no' }, { title: '状态', dataIndex: 'status' }, { title: '类型', dataIndex: 'type' },
      { title: '用户申请金额', dataIndex: 'requested_refund_cents' }, { title: '商品退款申请金额', dataIndex: 'requested_product_refund_cents' }, { title: '配送费退款申请金额', dataIndex: 'requested_delivery_refund_cents' },
      { title: '人工审核商品退款金额', dataIndex: 'approved_product_refund_cents' }, { title: '人工审核配送费退款金额', dataIndex: 'approved_delivery_refund_cents' }, { title: '总审核退款金额', dataIndex: 'approved_refund_cents' },
      { title: '人工备注', dataIndex: 'admin_note' }, { title: '操作', render: (_: unknown, item: AdminAfterSale) => <Space><Button onClick={() => onApprove(item)}>审核通过</Button><Button onClick={() => onReject(item)}>审核拒绝</Button></Space> }
    ]} />
  </Card>;
}
