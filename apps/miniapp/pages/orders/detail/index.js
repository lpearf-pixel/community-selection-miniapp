const { request, formatYuan } = require('../../../utils/api');

function decorate(order) { return { ...order, amount_yuan: formatYuan(order.payable_amount_cents || order.total_amount_cents), product: order.product ? { ...order.product, price_yuan: formatYuan(order.product.price_cents) } : null }; }
Page({ data: { order: null, order_id: '' }, onLoad(query) { this.setData({ order_id: query.id || '' }); this.loadOrder(query.id); }, loadOrder(id) { return request({ url: `/api/me/orders/${id}` }).then((order) => this.setData({ order: decorate(order) })); }, goPickupCode() { wx.navigateTo({ url: `/pages/pickup/code/index?id=${this.data.order_id}` }); }, applyAfterSale() { wx.navigateTo({ url: `/pages/after-sales/apply/index?order_id=${this.data.order_id}` }); } });
