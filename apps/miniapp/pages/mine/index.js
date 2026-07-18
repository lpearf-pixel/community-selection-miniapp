const {
  getSelectedCommunity,
  getSelectedPickupStore,
} = require('../../utils/selection');
const { getCartCount } = require('../../utils/cart');
const { getMeCenterSummary } = require('../../utils/center');

Page({
  data: {
    summary: null,
    profileRoleText: '',
    leaderCenterAvailable: false,
    community: null,
    pickupStore: null,
    cartCount: 0,
    loading: false,
    error: ''
  },

  summaryRequestId: 0,

  onShow() {
    this.setData({
      community: getSelectedCommunity(),
      pickupStore: getSelectedPickupStore(),
      cartCount: getCartCount()
    });
    this.loadSummary();
  },

  onPullDownRefresh() {
    this.loadSummary().finally(() => wx.stopPullDownRefresh());
  },

  loadSummary() {
    const requestId = ++this.summaryRequestId;
    this.setData({ loading: true, error: '' });
    return getMeCenterSummary()
      .then((summary) => {
        if (requestId !== this.summaryRequestId) return;
        const navigation = summary.navigation || {};
        const profile = summary.profile || {};
        const leader_center_available = Boolean(navigation.leader_center_available);
        this.setData({
          summary,
          profileRoleText: profile.role === 'leader' ? '开团人' : '社区用户',
          leaderCenterAvailable: leader_center_available,
          loading: false,
          error: ''
        });
      })
      .catch((error) => {
        if (requestId !== this.summaryRequestId) return;
        this.setData({
          loading: false,
          error: error.message || '个人中心加载失败'
        });
      });
  },

  retrySummary() {
    this.loadSummary();
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  goAfterSales() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  goLeaderCenter() {
    if (!this.data.leaderCenterAvailable) return;
    wx.navigateTo({ url: '/pages/leader/center/index' });
  },

  goCart() {
    wx.navigateTo({ url: '/pages/cart/index' });
  },

  goCommunities() {
    wx.navigateTo({ url: '/pages/communities/index' });
  },

  goPickupStores() {
    wx.navigateTo({ url: '/pages/pickup/select/index' });
  }
});
