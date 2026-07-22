const { getApiBaseUrl } = require('../../utils/api');
const { getCurrentUser } = require('../../utils/user');
const { getSelectedCommunity, getSelectedPickupStore } = require('../../utils/selection');

Page({
  data: { group_buy_id: '', quantity: 1, receiver_name: '', receiver_phone: '', pickup_store_id: '', community_id: '' },
  onLoad(query) {
    const user = getCurrentUser();
    const community = getSelectedCommunity();
    const pickupStore = getSelectedPickupStore();
    this.setData({
      group_buy_id: query.group_buy_id || '',
      receiver_name: user.receiver_name || user.nickname || '',
      receiver_phone: user.receiver_phone || '',
      pickup_store_id: pickupStore && pickupStore.pickup_store_id || '',
      community_id: community && community.community_id || '',
    });
  },
  onNameInput(event) {
    this.setData({ receiver_name: event.detail.value });
  },
  onPhoneInput(event) {
    this.setData({ receiver_phone: event.detail.value });
  },
  onQuantityInput(event) {
    this.setData({ quantity: Number(event.detail.value) || 1 });
  },
  submit() {
    const user = getCurrentUser();
    const apiBaseUrl = getApiBaseUrl();
    if (!this.data.pickup_store_id) {
      wx.showToast({ title: '请先选择自提点', icon: 'none' });
      return;
    }
    wx.request({
      url: `${apiBaseUrl}/api/orders`,
      method: 'POST',
      data: {
        group_buy_id: this.data.group_buy_id,
        user_id: user.user_id || undefined,
        user_openid: user.openid,
        client_request_id: `miniapp-${Date.now()}`,
        quantity: this.data.quantity,
        pickup_type: 'store',
        pickup_store_id: this.data.pickup_store_id,
        community_id: this.data.community_id || undefined,
        receiver_name: this.data.receiver_name || '测试用户',
        receiver_phone: this.data.receiver_phone || '13800000001'
      },
      success: (res) => {
        const order = res.data && res.data.data;
        if (!res.data || !res.data.success || !order) {
          wx.showToast({ title: (res.data && res.data.message) || '下单失败', icon: 'none' });
          return;
        }
        wx.request({
          url: `${apiBaseUrl}/api/payments/mock`,
          method: 'POST',
          data: { order_id: order.id },
          success: (paymentResponse) => {
            if (paymentResponse.data && paymentResponse.data.success) {
              wx.navigateTo({ url: '/pages/orders/index' });
              return;
            }
            wx.showToast({ title: (paymentResponse.data && paymentResponse.data.message) || '支付失败', icon: 'none' });
          },
          fail: () => wx.showToast({ title: '支付请求失败', icon: 'none' })
        });
      }
    });
  }
});
