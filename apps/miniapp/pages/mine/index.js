const { getCurrentUser } = require('../../utils/user');
const { getSelectedCommunity, getSelectedPickupStore } = require('../../utils/selection');
Page({
  data: { user: null, community: null, pickupStore: null },
  onShow() { this.setData({ user: getCurrentUser(), community: getSelectedCommunity(), pickupStore: getSelectedPickupStore() }); },
  goOrders() { wx.navigateTo({ url: '/pages/orders/index' }); },
  goCommunities() { wx.navigateTo({ url: '/pages/communities/index' }); },
  goPickupStores() { wx.navigateTo({ url: '/pages/pickup/select/index' }); }
});
