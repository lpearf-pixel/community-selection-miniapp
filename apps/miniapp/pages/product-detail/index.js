const config = require('../../config');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
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
        this.setData({
          product: {
            ...body.data,
            price_yuan: formatYuan(body.data.price_cents)
          }
        });
      }
    });
  }
});
