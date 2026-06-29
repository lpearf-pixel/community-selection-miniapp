const { apiBaseUrl } = require('../../config');

Page({
  data: { group_buy_id: '', quantity: 1, receiver_name: '', receiver_phone: '' },
  onLoad(query) {
    this.setData({ group_buy_id: query.group_buy_id || '' });
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
    wx.request({
      url: `${apiBaseUrl}/api/orders`,
      method: 'POST',
      data: {
        group_buy_id: this.data.group_buy_id,
        user_openid: 'customer-openid',
        client_request_id: `miniapp-${Date.now()}`,
        quantity: this.data.quantity,
        receiver_name: this.data.receiver_name || '测试用户',
        receiver_phone: this.data.receiver_phone || '13800000001'
      },
      success: () => wx.navigateTo({ url: '/pages/orders/index' })
    });
  }
});
