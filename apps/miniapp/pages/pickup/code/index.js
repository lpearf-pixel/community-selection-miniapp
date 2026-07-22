const { request } = require('../../../utils/api');
Page({
  data: { code: null, loading: false, error: '' },
  onLoad(query) { const orderId = query.id || query.order_id || ''; if (!orderId) { this.setData({ error: '缺少订单编号' }); return; } this.loadCode(orderId); },
  loadCode(orderId) { this.setData({ loading: true, error: '' }); request({ url: `/api/me/orders/${orderId}/pickup-code` }).then((code) => this.setData({ code })).catch((error) => this.setData({ error: error.message || '暂不可查看自提凭证' })).finally(() => this.setData({ loading: false })); }
});

