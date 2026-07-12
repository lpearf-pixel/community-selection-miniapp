import { Card, Descriptions, Timeline } from 'antd';
import type { AdminOrderDetail } from '../../api/adminOrders';

export function AdminOrderDetailPage({ order }: { order: AdminOrderDetail & { timeline?: Array<{ id: string; title: string; created_at: string }> } }) {
  return <Card title="订单详情">
    <Descriptions column={2} bordered items={[
      { key: 'order_no', label: '订单号', children: order.order_no },
      { key: 'order_type', label: '订单类型', children: order.order_type },
      { key: 'product_amount_cents', label: '商品金额', children: order.product_amount_cents },
      { key: 'delivery_fee_cents', label: '配送费', children: order.delivery_fee_cents },
      { key: 'pay_amount_cents', label: '实付金额', children: order.pay_amount_cents },
      { key: 'product_refund_amount_cents', label: '商品退款金额', children: order.product_refund_amount_cents },
      { key: 'delivery_refund_amount_cents', label: '配送费退款金额', children: order.delivery_refund_amount_cents },
      { key: 'refund_amount_cents', label: '总退款金额', children: order.refund_amount_cents },
      { key: 'remaining_refundable_amount_cents', label: '剩余可退金额', children: order.remaining_refundable_amount_cents },
      { key: 'inventory_deducted_quantity', label: '已扣库存', children: order.inventory_summary?.deducted_quantity ?? 0 },
      { key: 'inventory_restored_quantity', label: '已回补库存', children: order.inventory_summary?.restored_quantity ?? 0 },
      { key: 'inventory_remaining_restorable_quantity', label: '剩余可回补库存', children: order.inventory_summary?.remaining_restorable_quantity ?? 0 },
      { key: 'current_product_stock', label: '当前商品库存', children: order.inventory_summary?.current_product_stock ?? 0 },
      { key: 'latest_inventory_event', label: '最近库存事件', children: order.inventory_summary?.latest_inventory_event ?? '-' },
      { key: 'receiver_phone_masked', label: '脱敏手机号', children: order.receiver_phone_masked },
      { key: 'receiver_address_masked', label: '脱敏地址', children: order.receiver_address_masked }
    ]} />
    <Timeline items={(order.timeline ?? []).map((item) => ({ key: item.id, children: `${item.title} ${item.created_at}` }))} />
  </Card>;
}
