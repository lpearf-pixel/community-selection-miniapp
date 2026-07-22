const { apiBaseUrl } = require('../../config');

Page({
  data: { groupBuys: [] },
  onLoad() {
    wx.request({
      url: `${apiBaseUrl}/api/group-buys`,
      success: (res) => this.setData({ groupBuys: res.data.data || [] })
    });
  },
  openDetail(event) {
    wx.navigateTo({ url: `/pages/group-buy-detail/index?id=${event.currentTarget.dataset.id}` });
  }
});
