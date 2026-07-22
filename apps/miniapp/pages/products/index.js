const config = require('../../config');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

Page({
  data: {
    products: []
  },
  onLoad() {
    wx.request({
      url: `${config.apiBaseUrl}/api/products`,
      success: (res) => {
        const body = res.data || {};
        if (!body.success) return;
        const products = (body.data.items || []).map((item) => ({
          ...item,
          price_yuan: formatYuan(item.price_cents)
        }));
        this.setData({ products });
      }
    });
  },
  goDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/product-detail/index?id=${id}` });
  }
});
