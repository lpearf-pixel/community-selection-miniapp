const { request, createMockPayment } = require('../../../utils/api');
const { getCurrentUser } = require('../../../utils/user');

Page({
  data: { type: 'normal', product_id: '', group_buy_id: '', quantity: 1, pickup_store_id: '', community_id: '', receiver_name: '', receiver_phone: '', receiver_address: '', submitting: false },
  onLoad(query) { this.setData({ type: query.type === 'group_buy' ? 'group_buy' : 'normal', product_id: query.product_id || '', group_buy_id: query.group_buy_id || '' }); },
  onInput(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  submit() {
    const isGroupBuy = this.data.type === 'group_buy';
    const user = getCurrentUser();
    const payload = { client_request_id: `miniapp-l20-${Date.now()}`, user_id: user.user_id || undefined, user_openid: user.openid, quantity: Number(this.data.quantity) || 1, pickup_store_id: this.data.pickup_store_id || undefined, community_id: this.data.community_id || undefined, receiver_name: this.data.receiver_name || '测试用户', receiver_phone: this.data.receiver_phone || '13800000001', receiver_address: this.data.receiver_address || undefined, product_id: isGroupBuy ? undefined : this.data.product_id, group_buy_id: isGroupBuy ? this.data.group_buy_id : undefined };
    this.setData({ submitting: true });
    request({ url: isGroupBuy ? '/api/orders' : '/api/orders/normal', method: 'POST', data: payload })
      .then((order) => createMockPayment(order.id).then(() => order))
      .then((order) => wx.redirectTo({ url: `/pages/orders/detail/index?id=${order.id}` }))
      .finally(() => this.setData({ submitting: false }));
  }
});
