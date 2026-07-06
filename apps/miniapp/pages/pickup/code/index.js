const { getJSON } = require('../../../utils/api');

Page({
  data: {
    orderId: '',
    pickup: null,
    loading: false,
    error: '',
    empty: false
  },
  onLoad(query) {
    this.setData({ orderId: query.order_id || query.id || '' });
    this.loadPickupCode(query.order_id || query.id || '');
  },
  loadPickupCode(orderId) {
    if (!orderId) {
      this.setData({ error: '缺少订单 ID', empty: true });
      return;
    }
    this.setData({ loading: true, error: '', empty: false });
    getJSON(`/api/me/orders/${orderId}/pickup-code`)
      .then((pickup) => this.setData({ pickup, empty: !pickup }))
      .catch((error) => this.setData({ error: String(error || '自提凭证加载失败') }))
      .finally(() => this.setData({ loading: false }));
  }
});
