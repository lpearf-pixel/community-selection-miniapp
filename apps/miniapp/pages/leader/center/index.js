const {
  getLeaderCenterSummary,
  toLeaderCenterViewModel,
} = require('../../../utils/center');

function withdrawalStatusTone(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('reject') || value.includes('fail')) return 'danger';
  if (value.includes('process') || value.includes('complete') || value.includes('paid')) return 'success';
  if (value.includes('approve')) return 'brand';
  if (value.includes('pending')) return 'warning';
  return 'neutral';
}

function decorateSummary(summary) {
  const viewModel = toLeaderCenterViewModel(summary);
  return {
    ...viewModel,
    withdrawals: {
      ...viewModel.withdrawals,
      latest: (viewModel.withdrawals.latest || []).map((item) => ({
        ...item,
        theme_status_tone: withdrawalStatusTone(item.status || item.status_text),
      })),
    },
  };
}

Page({
  data: {
    summary: null,
    loading: false,
    error: '',
    forbidden: false,
  },

  summaryRequestId: 0,

  onShow() {
    if (this.data.forbidden) return;
    this.loadSummary();
  },

  onPullDownRefresh() {
    if (this.data.forbidden) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadSummary().finally(() => wx.stopPullDownRefresh());
  },

  loadSummary() {
    const requestId = ++this.summaryRequestId;
    this.setData({ loading: true, error: '' });
    return getLeaderCenterSummary()
      .then((summary) => {
        if (requestId !== this.summaryRequestId) return;
        this.setData({
          summary: decorateSummary(summary),
          loading: false,
          error: '',
          forbidden: false,
        });
      })
      .catch((error) => {
        if (requestId !== this.summaryRequestId) return;
        if (error && error.statusCode === 403) {
          this.setData({
            summary: null,
            loading: false,
            forbidden: true,
            error: '当前账号不是开团人，无法访问团长中心',
          });
          return;
        }
        this.setData({
          loading: false,
          error: error.message || '团长中心加载失败',
        });
      });
  },

  retrySummary() {
    if (this.data.forbidden) return;
    this.loadSummary();
  },

  goWithdrawals() {
    const navigation = this.data.summary && this.data.summary.navigation;
    if (!navigation || !navigation.withdrawal_entry_available) return;
    wx.navigateTo({ url: '/pages/leader/withdrawals/index' });
  },

  goMine() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/mine/index' }),
    });
  },
});

module.exports = { decorateSummary, withdrawalStatusTone };
