const { request } = require('../../../utils/api');
Page({
  data: { balance: 0, items: [], selected: {}, selectedTotal: 0, withdrawals: [], submitting: false, notice: '提交后由后台人工审核；审核通过后由工作人员线下处理，本页面不代表自动到账。' },
  onLoad() { this.load(); },
  async load() {
    const commissions = await request({ url: '/api/leaders/me/withdrawable-commissions' });
    const withdrawals = await request({ url: '/api/leaders/me/withdrawals' });
    this.setData({ balance: commissions.available_balance_cents || 0, items: commissions.items || [], withdrawals: withdrawals || [] });
  },
  toggle(e) {
    const id = e.currentTarget.dataset.id;
    const selected = { ...this.data.selected, [id]: !this.data.selected[id] };
    const selectedTotal = this.data.items.filter((i) => selected[i.commission_id]).reduce((s, i) => s + i.final_amount_cents, 0);
    this.setData({ selected, selectedTotal });
  },
  async submit() {
    if (this.data.submitting) return;
    const commission_ids = this.data.items.filter((i) => this.data.selected[i.commission_id]).map((i) => i.commission_id);
    if (!commission_ids.length) return wx.showToast({ title: '请选择整笔奖励', icon: 'none' });
    this.setData({ submitting: true });
    try {
      const client_request_id = `wd-${Date.now()}-${commission_ids.join('-').slice(0, 20)}`;
      await request({ url: '/api/leaders/me/withdrawals', method: 'POST', data: { client_request_id, commission_ids } });
      wx.showToast({ title: '已提交人工审核', icon: 'success' });
      this.setData({ selected: {}, selectedTotal: 0 });
      await this.load();
    } finally { this.setData({ submitting: false }); }
  },
  yuan(e) { return ((e || 0) / 100).toFixed(2); }
});
