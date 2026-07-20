const { request } = require('../../../utils/api');
const { canApplyAfterSale, formatOrderAmount } = require('../../../utils/order');
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
  data: {
    order_id: '',
    types,
    typeIndex: 0,
    reason: '',
    description: '',
    remaining_refundable_amount_cents: 0,
    refund_amount_yuan: '0.00',
    loading: true,
    can_submit: false,
    submitting: false,
    error: ''
  },
  onLoad(query) {
    const orderId = query.order_id || query.id || '';
    this.setData({ order_id: orderId });
    if (!orderId) {
      this.setData({ loading: false, error: '缺少订单编号' });
      return;
    }
    this.loadOrder();
  },
  loadOrder() {
    this.setData({ loading: true, can_submit: false, error: '' });
    return request({ url: `/api/me/orders/${this.data.order_id}` })
      .then((order) => {
        const cents = Number(order.remaining_refundable_amount_cents || 0);
        const canApply = canApplyAfterSale(order);
        this.setData({
          remaining_refundable_amount_cents: cents,
          refund_amount_yuan: formatOrderAmount(order.remaining_refundable_amount_cents),
          can_submit: canApply && cents > 0,
          error: !canApply ? '当前订单状态不可申请售后' : (cents <= 0 ? '该订单已无可退金额' : '')
        });
      })
      .catch((error) => this.setData({ can_submit: false, error: error.message || '订单金额加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },
  onTypeChange(event) { this.setData({ typeIndex: Number(event.detail.value || 0) }); },
  onInput(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  submit() {
    if (this.data.submitting) return;
    const selected = this.data.types[this.data.typeIndex];
    if (this.data.loading || !this.data.can_submit) { this.setData({ error: this.data.error || '订单退款金额尚未就绪' }); return; }
    if (!this.data.order_id) { this.setData({ error: '缺少订单编号' }); return; }
    if (!this.data.reason) { this.setData({ error: '请填写售后原因' }); return; }
    this.setData({ submitting: true, error: '' });
    request({ url: `/api/me/orders/${this.data.order_id}/after-sales`, method: 'POST', data: { type: selected.value, reason: this.data.reason, description: this.data.description || null } })
      .then(() => wx.redirectTo({ url: `/pages/after-sales/detail/index?order_id=${this.data.order_id}` }))
      .catch((error) => this.setData({ error: error.message || '提交售后失败' }))
      .finally(() => this.setData({ submitting: false }));
  }
});
