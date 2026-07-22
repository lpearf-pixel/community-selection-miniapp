const { request } = require('../../../utils/api');
const { formatOrderAmount } = require('../../../utils/order');
function statusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('reject') || value.includes('fail') || value.includes('cancel')) return 'danger';
  if (value.includes('refund') || value.includes('complete') || value.includes('approve')) return 'success';
  if (value.includes('pending') || value.includes('review')) return 'warning';
  return 'neutral';
}
function decorate(item) { return { ...item, refund_yuan: formatOrderAmount(item.requested_refund_cents || item.approved_refund_cents || 0), product_refund_yuan: formatOrderAmount(item.requested_product_refund_cents || item.approved_product_refund_cents || 0), delivery_refund_yuan: formatOrderAmount(item.requested_delivery_refund_cents || item.approved_delivery_refund_cents || 0), theme_status_tone: statusTone(item.status) }; }
Page({
  data: { order_id: '', items: [], loading: false, error: '' },
  onLoad(query) { const orderId = query.order_id || ''; this.setData({ order_id: orderId }); if (orderId) this.loadList(orderId); else this.setData({ error: '缺少订单编号' }); },
  loadList(orderId) { this.setData({ loading: true, error: '' }); request({ url: `/api/me/orders/${orderId}/after-sales` }).then((items) => this.setData({ items: (items || []).map(decorate) })).catch((error) => this.setData({ error: error.message || '售后进度加载失败' })).finally(() => this.setData({ loading: false })); },
  retryList() { return this.loadList(this.data.order_id); },
  backOrder() { wx.navigateTo({ url: `/pages/orders/detail/index?id=${this.data.order_id}` }); }
});

module.exports = { decorate, statusTone };
