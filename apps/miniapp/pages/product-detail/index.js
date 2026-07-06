const config = require('../../config');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function decorateProduct(product) {
  return {
    ...product,
    price_yuan: formatYuan(product.price_cents),
    active_group_buys: (product.active_group_buys || []).map((item) => ({
      ...item,
      price_yuan: formatYuan(item.price_cents)
    }))
  };
}

Page({
  data: {
    product: null
  },
  onLoad(options) {
    wx.request({
      url: `${config.apiBaseUrl}/api/products/${options.id}`,
      success: (res) => {
        const body = res.data || {};
        if (!body.success) return;
        this.setData({ product: decorateProduct(body.data) });
      }
    });
  },
  goNormalBuy() {
    const product = this.data.product;
    if (!product) return;
    wx.navigateTo({ url: `/pages/orders/confirm/index?type=normal&product_id=${product.product_id}` });
  },
  goGroupBuy(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/orders/confirm/index?type=group_buy&group_buy_id=${id}` });
  }
});
