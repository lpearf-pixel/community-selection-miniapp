const { request } = require('../../utils/api');

function statusPresentation(status) {
  if (status === 'success') return { text: '已成团', tone: 'success' };
  if (status === 'failed' || status === 'cancelled') return { text: '已结束', tone: 'danger' };
  if (status === 'pending') return { text: '待成团', tone: 'warning' };
  return { text: '进行中', tone: 'brand' };
}

Page({
  data: { groupBuys: [], loading: true, error: '' },
  onLoad() {
    return this.loadGroupBuys();
  },
  loadGroupBuys() {
    this.setData({ loading: true, error: '' });
    return request({ url: '/api/group-buys' })
      .then((data) => {
        const items = Array.isArray(data) ? data : (data && data.items) || [];
        this.setData({
          groupBuys: items.map((item) => ({
            ...item,
            themeStatus: statusPresentation(item.status),
          })),
        });
      })
      .catch((error) => this.setData({ error: error.message || '团购加载失败' }))
      .finally(() => this.setData({ loading: false }));
  },
  openDetail(event) {
    wx.navigateTo({ url: `/pages/group-buy-detail/index?id=${event.currentTarget.dataset.id}` });
  },
});

module.exports = { statusPresentation };
