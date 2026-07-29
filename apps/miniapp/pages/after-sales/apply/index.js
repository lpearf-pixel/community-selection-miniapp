const { request } = require('../../../utils/api');
const { canApplyAfterSale, formatOrderAmount } = require('../../../utils/order');
const { parseRefundYuan, refundDefaultsForType } = require('./refund-model');
const types = [
  { value: 'bad_quality', label: '品质问题' },
  { value: 'short_weight', label: '缺斤少两' },
  { value: 'missing_item', label: '少件漏发' },
  { value: 'wrong_item', label: '商品不符' },
  { value: 'damaged', label: '包装破损' },
  { value: 'not_fresh', label: '不新鲜' },
  { value: 'other', label: '其他' },
  { value: 'delivery_not_started', label: '未配送' },
  { value: 'delivery_failed', label: '配送失败' },
  { value: 'severe_delay', label: '严重延误' },
  { value: 'whole_order_unfulfillable', label: '整单无法履约' }
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
    product_refund_amount_yuan: '',
    delivery_refund_notice: refundDefaultsForType(types[0].value).delivery_refund_notice,
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
        const cents = Number(order.remaining_product_refundable_amount_cents || 0);
        const canApply = canApplyAfterSale(order);
        this.setData({
          remaining_refundable_amount_cents: cents,
          refund_amount_yuan: formatOrderAmount(order.remaining_product_refundable_amount_cents),
          product_refund_amount_yuan: formatOrderAmount(cents),
          can_submit: canApply && cents > 0,
          error: !canApply ? '当前订单状态不可申请售后' : (cents <= 0 ? '该订单已无可退金额' : '')
        });
      })
      .catch((error) => this.setData({ can_submit: false, error: error.message || '订单金额加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },
  onTypeChange(event) {
    const typeIndex = Number(event.detail.value || 0);
    const defaults = refundDefaultsForType(this.data.types[typeIndex].value);
    this.setData({
      typeIndex: typeIndex,
      delivery_refund_notice: defaults.delivery_refund_notice
    });
  },
  onInput(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  submit() {
    if (this.data.submitting) return;
    const selected = this.data.types[this.data.typeIndex];
    if (this.data.loading || !this.data.can_submit) { this.setData({ error: this.data.error || '订单退款金额尚未就绪' }); return; }
    if (!this.data.order_id) { this.setData({ error: '缺少订单编号' }); return; }
    if (!this.data.reason) { this.setData({ error: '请填写售后原因' }); return; }
    let requestedProductRefundCents;
    try {
      requestedProductRefundCents = parseRefundYuan(this.data.product_refund_amount_yuan);
    } catch (error) {
      this.setData({ error: error.message });
      return;
    }
    if (requestedProductRefundCents > this.data.remaining_refundable_amount_cents) {
      this.setData({ error: '商品退款金额超过商品剩余可退金额' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    request({ url: `/api/me/orders/${this.data.order_id}/after-sales`, method: 'POST', data: { type: selected.value, reason: this.data.reason, description: this.data.description || null, requested_product_refund_cents: requestedProductRefundCents } })
      .then(() => wx.redirectTo({ url: `/pages/after-sales/detail/index?order_id=${this.data.order_id}` }))
      .catch((error) => this.setData({ error: error.message || '提交售后失败' }))
      .finally(() => this.setData({ submitting: false }));
  }
});
