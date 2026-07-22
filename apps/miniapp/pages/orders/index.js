const { apiBaseUrl } = require('../../config');

Page({
  data: { orders: [] },
  onLoad() {
    wx.request({
      url: `${apiBaseUrl}/api/orders`,
      success: (res) => this.setData({ orders: res.data.data || [] })
    });
  }
});
