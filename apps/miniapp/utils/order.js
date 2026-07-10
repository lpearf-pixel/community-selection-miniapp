function formatOrderType(orderType) {
  return orderType === 'group_buy' ? '开团订单' : '普通购买';
}

function formatOrderAmount(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function hasAfterSale(order) {
  return Boolean(order && (order.after_sale_summary?.has_after_sale || order.after_sale_case_count > 0 || order.latest_after_sale_status));
}

function canShowPickupCode(order) {
  if (!order) return false;
  return order.pay_status === 'paid' || ['ready', 'picked', 'completed', 'grouped', 'preparing'].includes(order.order_status);
}

function canApplyAfterSale(order) {
  if (!order) return false;
  return order.pay_status === 'paid' && !['refunded', 'closed'].includes(order.order_status) && order.refund_status !== 'success';
}

function normalizeOrder(order) {
  const product = order.product || {
    product_id: order.product_id,
    name: order.product_name || '',
    cover_image: order.product_cover_image || null
  };
  const pickup = order.pickup || {
    pickup_store_id: order.pickup_store_id || null,
    pickup_store_name: order.pickup_store_name || null,
    pickup_store_address: order.pickup_store_address || null,
    pickup_store_phone: order.pickup_store_phone || null
  };
  const afterSaleSummary = order.after_sale_summary || {
    has_after_sale: Boolean(order.after_sale_case_count || order.latest_after_sale_status),
    latest_status: order.latest_after_sale_status || null
  };
  return {
    ...order,
    id: order.order_id || order.id,
    product,
    pickup,
    after_sale_summary: afterSaleSummary,
    order_type_text: formatOrderType(order.order_type),
    amount_yuan: formatOrderAmount(order.pay_amount_cents || order.total_amount_cents),
    product_amount_yuan: formatOrderAmount(order.product_amount_cents || order.total_amount_cents),
    delivery_fee_yuan: formatOrderAmount(order.delivery_fee_cents || 0),
    pay_amount_yuan: formatOrderAmount(order.pay_amount_cents || order.total_amount_cents),
    can_show_pickup_code: canShowPickupCode(order),
    can_apply_after_sale: canApplyAfterSale(order),
    has_after_sale: hasAfterSale({ ...order, after_sale_summary: afterSaleSummary })
  };
}

module.exports = { formatOrderType, formatOrderAmount, canShowPickupCode, canApplyAfterSale, hasAfterSale, normalizeOrder };
