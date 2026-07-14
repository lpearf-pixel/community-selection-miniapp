const { request } = require('../../../utils/api');
const STORAGE_KEY = 'leader_withdrawal_pending_request';
function randomId() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  return `wd-${Date.now().toString(36)}-${bytes}`;
}
function selectionKey(ids) { return ids.slice().sort().join('|'); }
Page({
  data: { balance: 0, items: [], selected: {}, selectedTotal: 0, withdrawals: [], submitting: false, pendingRequestId: '', notice: '提交后由后台人工审核；审核通过后由工作人员线下处理，本页面不代表自动到账。' },
  onLoad() { this.restorePendingRequest(); this.load(); },
  restorePendingRequest() {
    const pending = wx.getStorageSync(STORAGE_KEY);
    if (pending && pending.client_request_id) this.setData({ pendingRequestId: pending.client_request_id });
  },
  async load() {
    const commissions = await request({ url: '/api/leaders/me/withdrawable-commissions' });
    const withdrawals = await request({ url: '/api/leaders/me/withdrawals' });
    this.setData({ balance: commissions.available_balance_cents || 0, items: commissions.items || [], withdrawals: withdrawals || [] });
  },
  ensureRequestId(ids) {
    const key = selectionKey(ids);
    const pending = wx.getStorageSync(STORAGE_KEY);
    if (pending && pending.selection_key === key && pending.client_request_id) return pending.client_request_id;
    const client_request_id = randomId();
    wx.setStorageSync(STORAGE_KEY, { selection_key: key, client_request_id, created_at: Date.now() });
    this.setData({ pendingRequestId: client_request_id });
    return client_request_id;
  },
  toggle(e) {
    const id = e.currentTarget.dataset.id;
    const selected = { ...this.data.selected, [id]: !this.data.selected[id] };
    const selectedIds = this.data.items.filter((i) => selected[i.commission_id]).map((i) => i.commission_id);
    const selectedTotal = this.data.items.filter((i) => selected[i.commission_id]).reduce((s, i) => s + i.final_amount_cents, 0);
    this.ensureRequestId(selectedIds);
    this.setData({ selected, selectedTotal });
  },
  async submit() {
    if (this.data.submitting) return;
    const commission_ids = this.data.items.filter((i) => this.data.selected[i.commission_id]).map((i) => i.commission_id);
    if (!commission_ids.length) return wx.showToast({ title: '请选择整笔奖励', icon: 'none' });
    const client_request_id = this.ensureRequestId(commission_ids);
    this.setData({ submitting: true });
    try {
      await request({ url: '/api/leaders/me/withdrawals', method: 'POST', data: { client_request_id, commission_ids } });
      wx.removeStorageSync(STORAGE_KEY);
      wx.showToast({ title: '已提交人工审核', icon: 'success' });
      this.setData({ selected: {}, selectedTotal: 0, pendingRequestId: '' });
      await this.load();
    } finally { this.setData({ submitting: false }); }
  },
  yuan(e) { return ((e || 0) / 100).toFixed(2); }
});
