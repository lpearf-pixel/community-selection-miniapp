const { request } = require('../../utils/api');
const { payOrder } = require('../../utils/payment');
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
    if (!this.data.pickup_store_id) {
      wx.showToast({ title: '请先选择自提点', icon: 'none' });
      return;
    }
    request({
      url: '/api/orders',
      method: 'POST',
      data: {
        group_buy_id: this.data.group_buy_id,
        client_request_id: `miniapp-${Date.now()}`,
        quantity: this.data.quantity,
        pickup_type: 'store',
        pickup_store_id: this.data.pickup_store_id,
        community_id: this.data.community_id || undefined,
        receiver_name: this.data.receiver_name || '测试用户',
        receiver_phone: this.data.receiver_phone || '13800000001'
      },
    })
      .then((order) => payOrder(order.id))
      .then(() => wx.navigateTo({ url: '/pages/orders/index' }))
      .catch((error) => {
        const cancelled = /cancel/i.test(error.errMsg || error.message || '');
        wx.showToast({
          title: cancelled ? '订单已保留，可稍后支付' : (error.message || '支付失败'),
          icon: 'none',
        });
      });
  }
});
