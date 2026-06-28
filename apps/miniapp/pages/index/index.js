Page({
  goProducts() {
    wx.navigateTo({ url: '/pages/products/index' });
  },
  goGroupBuys() {
    wx.navigateTo({ url: '/pages/group-buys/index' });
  },
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  }
});
