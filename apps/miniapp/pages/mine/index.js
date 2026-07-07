const { getCurrentUser } = require("../../utils/user");
const {
  getSelectedCommunity,
  getSelectedPickupStore,
} = require("../../utils/selection");
const { getCartCount } = require("../../utils/cart");
Page({
  data: { user: null, community: null, pickupStore: null, cartCount: 0 },
  onShow() {
    this.setData({
      user: getCurrentUser(),
      community: getSelectedCommunity(),
      pickupStore: getSelectedPickupStore(),
      cartCount: getCartCount(),
    });
  },
  goOrders() {
    wx.navigateTo({ url: "/pages/orders/index" });
  },
  goCart() {
    wx.navigateTo({ url: "/pages/cart/index" });
  },
  goCommunities() {
    wx.navigateTo({ url: "/pages/communities/index" });
  },
  goPickupStores() {
    wx.navigateTo({ url: "/pages/pickup/select/index" });
  },
});
