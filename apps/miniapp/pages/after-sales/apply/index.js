const { request } = require('../../../utils/api');
const types = [
  { value: 'bad_quality', label: '品质问题' },
  { value: 'short_weight', label: '缺斤少两' },
  { value: 'missing_item', label: '少件漏发' },
  { value: 'wrong_item', label: '商品不符' },
  { value: 'damaged', label: '包装破损' },
  { value: 'not_fresh', label: '不新鲜' },
  { value: 'other', label: '其他' }
];
Page({
  data: { order_id: '', types, typeIndex: 0, reason: '', description: '', requested_refund_cents: '', submitting: false, error: '' },
  onLoad(query) { this.setData({ order_id: query.order_id || query.id || '', requested_refund_cents: query.amount_cents || '' }); },
  onTypeChange(event) { this.setData({ typeIndex: Number(event.detail.value || 0) }); },
  onInput(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  submit() {
    const selected = this.data.types[this.data.typeIndex];
    if (!this.data.order_id) { this.setData({ error: '缺少订单编号' }); return; }
    if (!this.data.reason) { this.setData({ error: '请填写售后原因' }); return; }
    this.setData({ submitting: true, error: '' });
    request({ url: `/api/me/orders/${this.data.order_id}/after-sales`, method: 'POST', data: { type: selected.value, reason: this.data.reason, description: this.data.description || null, requested_refund_cents: this.data.requested_refund_cents ? Number(this.data.requested_refund_cents) : undefined } })
      .then(() => wx.redirectTo({ url: `/pages/after-sales/detail/index?order_id=${this.data.order_id}` }))
      .catch((error) => this.setData({ error: error.message || '提交售后失败' }))
      .finally(() => this.setData({ submitting: false }));
  }
});
