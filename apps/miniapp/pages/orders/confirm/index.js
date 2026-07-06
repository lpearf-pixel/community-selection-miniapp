const { apiBaseUrl } = require('../../../config');

Page({
  data: {
    type: 'normal',
    product_id: '',
    group_buy_id: '',
    quantity: 1,
    pickup_store_id: '',
    community_id: '',
    receiver_name: '',
    receiver_phone: '',
    receiver_address: ''
  },
  onLoad(query) {
    this.setData({
      type: query.type === 'group_buy' ? 'group_buy' : 'normal',
      product_id: query.product_id || '',
      group_buy_id: query.group_buy_id || ''
    });
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [field]: event.detail.value });
  },
  submit() {
    const isGroupBuy = this.data.type === 'group_buy';
    const url = isGroupBuy ? `${apiBaseUrl}/api/orders` : `${apiBaseUrl}/api/orders/normal`;
    const payload = {
      client_request_id: `miniapp-${Date.now()}`,
      user_openid: 'customer-openid',
      quantity: Number(this.data.quantity) || 1,
      pickup_store_id: this.data.pickup_store_id || undefined,
      community_id: this.data.community_id || undefined,
      receiver_name: this.data.receiver_name || '测试用户',
      receiver_phone: this.data.receiver_phone || '13800000001',
      receiver_address: this.data.receiver_address || undefined,
      product_id: isGroupBuy ? undefined : this.data.product_id,
      group_buy_id: isGroupBuy ? this.data.group_buy_id : undefined
    };
    wx.request({
      url,
      method: 'POST',
      data: payload,
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
