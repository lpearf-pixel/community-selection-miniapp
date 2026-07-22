const { apiBaseUrl } = require('../../config');

Page({
  data: { groupBuy: null },
  onLoad(query) {
    wx.request({
      url: `${apiBaseUrl}/api/group-buys/${query.id}`,
      success: (res) => this.setData({ groupBuy: res.data.data })
    });
  },
  join() {
    wx.navigateTo({ url: `/pages/join-order/index?group_buy_id=${this.data.groupBuy.id}` });
  }
});
