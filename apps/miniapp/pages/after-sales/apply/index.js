const { postJSON } = require('../../../utils/api');

const typeOptions = [
  { label: '品质问题', value: 'bad_quality' },
  { label: '重量不足', value: 'short_weight' },
  { label: '缺少商品', value: 'missing_item' },
  { label: '商品拿错', value: 'wrong_item' },
  { label: '商品破损', value: 'damaged' },
  { label: '不新鲜', value: 'not_fresh' },
  { label: '其他', value: 'other' }
];

function yuanToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

Page({
  data: {
    orderId: '',
    typeOptions,
    typeIndex: 0,
    reason: '',
    description: '',
    requested_refund_yuan: '',
    submitting: false,
    error: ''
  },
  onLoad(query) {
    this.setData({ orderId: query.order_id || query.id || '' });
  },
  onTypeChange(event) {
    this.setData({ typeIndex: Number(event.detail.value) || 0 });
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [field]: event.detail.value });
  },
  submit() {
    if (!this.data.orderId) {
      this.setData({ error: '缺少订单 ID' });
      return;
    }
    if (!this.data.reason) {
      this.setData({ error: '请填写售后原因' });
      return;
    }
    const selectedType = this.data.typeOptions[this.data.typeIndex].value;
    const payload = {
      type: selectedType,
      reason: this.data.reason,
      description: this.data.description || undefined,
      requested_refund_cents: this.data.requested_refund_yuan ? yuanToCents(this.data.requested_refund_yuan) : undefined
    };
    this.setData({ submitting: true, error: '' });
    postJSON(`/api/me/orders/${this.data.orderId}/after-sales`, payload)
      .then(() => wx.redirectTo({ url: `/pages/after-sales/detail/index?order_id=${this.data.orderId}` }))
      .catch((error) => this.setData({ error: String(error || '售后申请提交失败') }))
      .finally(() => this.setData({ submitting: false }));
  }
});
