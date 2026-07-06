const { request, formatYuan } = require('../../utils/api');

function decorateProduct(product) {
  return { ...product, price_yuan: formatYuan(product.price_cents), active_group_buys: (product.active_group_buys || []).map((item) => ({ ...item, price_yuan: formatYuan(item.price_cents) })) };
}

Page({
  data: { product: null },
  onLoad(options) { this.loadProduct(options.id); },
  loadProduct(id) { return request({ url: `/api/products/${id}` }).then((product) => this.setData({ product: decorateProduct(product) })); },
  goNormalBuy() { const p = this.data.product; if (p && p.can_normal_buy) wx.navigateTo({ url: `/pages/orders/confirm/index?type=normal&product_id=${p.product_id}` }); },
  goGroupBuy(event) { wx.navigateTo({ url: `/pages/orders/confirm/index?type=group_buy&group_buy_id=${event.currentTarget.dataset.id}` }); }
});
