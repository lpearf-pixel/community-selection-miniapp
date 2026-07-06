const { getJSON } = require('../../../utils/api');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function decorateOrder(order) {
  const afterSales = order.after_sales || [];
  return {
    ...order,
    order_type_text: order.order_type === 'group_buy' ? '开团订单' : '普通购买',
    amount_yuan: formatYuan(order.pay_amount_cents || order.total_amount_cents),
    product_name: order.product ? order.product.name : order.product_name,
    receiver_phone_masked: order.receiver ? order.receiver.receiver_phone_masked : order.receiver_phone_masked,
    pickup_store_name: order.pickup ? order.pickup.pickup_store_name : order.pickup_store_name,
    pickup_store_address: order.pickup ? order.pickup.pickup_store_address : '',
    after_sales: afterSales,
    after_sale_status_text: afterSales.length ? afterSales[0].status : '暂无售后'
  };
}

Page({
  data: {
    orderId: '',
    order: null,
    loading: false,
    error: '',
    empty: false
  },
  onLoad(query) {
    this.setData({ orderId: query.id || query.order_id || '' });
    this.loadOrder(query.id || query.order_id || '');
  },
  loadOrder(orderId) {
    if (!orderId) {
      this.setData({ error: '缺少订单 ID', empty: true });
      return;
    }
    this.setData({ loading: true, error: '', empty: false });
    getJSON(`/api/me/orders/${orderId}`)
      .then((order) => this.setData({ order: decorateOrder(order), empty: !order }))
      .catch((error) => this.setData({ error: String(error || '订单详情加载失败') }))
      .finally(() => this.setData({ loading: false }));
  },
  goPickupCode() {
    wx.navigateTo({ url: `/pages/pickup/code/index?order_id=${this.data.orderId}` });
  },
  goAfterSaleApply() {
    wx.navigateTo({ url: `/pages/after-sales/apply/index?order_id=${this.data.orderId}` });
  },
  goAfterSaleDetail() {
    wx.navigateTo({ url: `/pages/after-sales/detail/index?order_id=${this.data.orderId}` });
  }
});
