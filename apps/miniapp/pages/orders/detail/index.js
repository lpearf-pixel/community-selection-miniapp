const { request } = require('../../../utils/api');
const { normalizeOrder, formatOrderAmount } = require('../../../utils/order');
function decorate(order) {
  const normalized = normalizeOrder(order);
  const receiver = order.receiver || {};
  const pickup = order.pickup || {}; const delivery = order.delivery || {}; const fulfillment_type_text = order.fulfillment_type_text || pickup.fulfillment_type_text || (order.pickup_type === "delivery" ? "门店配送" : "到店自提"); return { ...normalized, pickup, delivery, product_refund_yuan: formatOrderAmount(order.product_refund_amount_cents || 0), delivery_refund_yuan: formatOrderAmount(order.delivery_refund_amount_cents || 0), remaining_refundable_yuan: formatOrderAmount(order.remaining_refundable_amount_cents || 0), fulfillment_type_text, receiver, receiver_phone_masked: receiver.receiver_phone_masked || order.receiver_phone_masked || '', after_sales: order.after_sales || [], timeline: order.timeline || [] };
}
Page({
  data: { order: null, order_id: '', loading: false, error: '' },
  onLoad(query) { const id = query.id || query.order_id || ''; this.setData({ order_id: id }); if (id) this.loadOrder(id); else this.setData({ error: '缺少订单编号' }); },
  loadOrder(id) { this.setData({ loading: true, error: '' }); return request({ url: `/api/me/orders/${id}` }).then((order) => this.setData({ order: decorate(order) })).catch((error) => this.setData({ error: error.message || '订单不存在或无权限' })).finally(() => this.setData({ loading: false })); },
  goPickupCode() { wx.navigateTo({ url: `/pages/pickup/code/index?id=${this.data.order_id}` }); },
  applyAfterSale() { wx.navigateTo({ url: `/pages/after-sales/apply/index?order_id=${this.data.order_id}&amount_cents=${this.data.order.pay_amount_cents || this.data.order.total_amount_cents}` }); },
  goAfterSale() { wx.navigateTo({ url: `/pages/after-sales/detail/index?order_id=${this.data.order_id}` }); },
  backList() { wx.navigateTo({ url: '/pages/orders/index' }); }
});
