const { getJSON } = require('../../../utils/api');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

Page({
  data: {
    orderId: '',
    cases: [],
    loading: false,
    error: '',
    empty: false
  },
  onLoad(query) {
    this.setData({ orderId: query.order_id || query.id || '' });
    this.loadAfterSales(query.order_id || query.id || '');
  },
  loadAfterSales(orderId) {
    if (!orderId) {
      this.setData({ error: '缺少订单 ID', empty: true });
      return;
    }
    this.setData({ loading: true, error: '', empty: false });
    getJSON(`/api/me/orders/${orderId}/after-sales`)
      .then((items) => {
        const cases = (items || []).map((item) => ({
          ...item,
          requested_refund_yuan: formatYuan(item.requested_refund_cents),
          approved_refund_yuan: formatYuan(item.approved_refund_cents)
        }));
        this.setData({ cases, empty: cases.length === 0 });
      })
      .catch((error) => this.setData({ error: String(error || '售后进度加载失败') }))
      .finally(() => this.setData({ loading: false }));
  }
});
