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
          complete: () => wx.navigateTo({ url: '/pages/orders/index' })
        });
      }
    });
  }
});
