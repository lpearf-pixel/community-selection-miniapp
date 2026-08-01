const {
  getMembership, activateLegacyMembership, claimMemberGift, releaseMemberGift,
  purchaseAnnualMembership,
} = require('../../utils/membership');
const { buildMembershipView, buildGiftClaimCommand } = require('./membership-model');

function commandKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

Page({
  data: { membership: null, orderId: '', loading: false, error: '' },
  onLoad(query) { this.setData({ orderId: query.order_id || '' }); this.loadMembership(); },
  onPullDownRefresh() { this.loadMembership().finally(() => wx.stopPullDownRefresh()); },
  loadMembership() {
    this.setData({ loading: true, error: '' });
    return getMembership()
      .then((value) => this.setData({ membership: buildMembershipView(value) }))
      .catch((error) => this.setData({ error: error.message || '会员权益加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },
  activateLegacy() {
    const eligibility = this.data.membership && this.data.membership.legacy_eligibility;
    if (!eligibility) return;
    this.setData({ loading: true, error: '' });
    activateLegacyMembership(eligibility.id, commandKey('legacy-member'))
      .then(() => { wx.showToast({ title: '会员已激活', icon: 'success' }); return this.loadMembership(); })
      .catch((error) => this.setData({ loading: false, error: error.message || '会员激活失败' }));
  },
  purchaseAnnual() {
    this.setData({ loading: true, error: '' });
    purchaseAnnualMembership(commandKey('annual-membership'))
      .then(() => {
        wx.showToast({ title: this.data.membership.active ? '续费成功' : '开通成功', icon: 'success' });
        return this.loadMembership();
      })
      .catch((error) => this.setData({ loading: false, error: error.message || '会员支付失败' }));
  },
  claimGift(event) {
    try {
      const command = buildGiftClaimCommand({
        orderId: this.data.orderId,
        campaignId: event.currentTarget.dataset.id,
        idempotencyKey: commandKey('member-gift-claim'),
      });
      this.setData({ loading: true, error: '' });
      claimMemberGift(command)
        .then(() => { wx.showToast({ title: '赠品已预留', icon: 'success' }); return this.loadMembership(); })
        .catch((error) => this.setData({ loading: false, error: error.message || '赠品领取失败' }));
    } catch (error) { this.setData({ error: error.message }); }
  },
  releaseGift(event) {
    this.setData({ loading: true, error: '' });
    releaseMemberGift(event.currentTarget.dataset.id, commandKey('member-gift-release'))
      .then(() => { wx.showToast({ title: '赠品预留已取消', icon: 'success' }); return this.loadMembership(); })
      .catch((error) => this.setData({ loading: false, error: error.message || '取消失败' }));
  },
});
