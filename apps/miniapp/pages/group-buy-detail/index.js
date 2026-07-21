const { apiBaseUrl } = require('../../config');

function formatGroupBuy(raw) {
  if (!raw) return null;
  const groupBuyId = raw.group_buy_id || raw.id;
  const targetCount = Number(raw.target_count || raw.min_quantity || 0);
  const paidQuantity = Number(raw.paid_quantity || raw.current_quantity || 0);
  const remainingQuantity = Math.max(0, Number(raw.remaining_quantity ?? (targetCount - paidQuantity)));
  const isExpired = Boolean(raw.is_expired || (raw.end_time && new Date(raw.end_time).getTime() <= Date.now()));
  const isSuccess = Boolean(raw.is_success || raw.status === 'success');
  const product = raw.product || {};
  const stock = Number(product.stock ?? raw.stock ?? 1);
  const isFailed = raw.status === 'failed' || (isExpired && !isSuccess);
  const canJoin = Boolean(raw.can_join ?? ((raw.status === 'pending' || raw.status === 'success') && !isExpired && stock > 0)) && !isFailed;
  return {
    ...raw,
    id: groupBuyId,
    group_buy_id: groupBuyId,
    product,
    target_count: targetCount,
    paid_quantity: paidQuantity,
    remaining_quantity: remainingQuantity,
    is_expired: isExpired,
    is_success: isSuccess,
    can_join: canJoin,
    is_failed: isFailed,
    status_text: isSuccess ? '已成团' : (isFailed ? '团购已结束' : '待成团'),
    manual_process_tip: isFailed ? '如已支付，请等待平台人工处理' : '',
    join_button_text: isFailed ? '团购已结束' : (isSuccess ? '已成团，可继续购买' : '参团下单'),
    status_tone: isSuccess ? 'success' : (isFailed ? 'danger' : 'warning')
  };
}

Page({
  data: { groupBuy: null, groupBuyId: '', loading: true, error: '' },
  onLoad(query) {
    this.setData({ groupBuyId: query.id, loading: true, error: '' });
    wx.request({
      url: `${apiBaseUrl}/api/group-buys/${query.id}`,
      success: (res) => this.setData({ groupBuy: formatGroupBuy(res.data.data), loading: false }),
      fail: (error) => this.setData({ loading: false, error: error.errMsg || '团购加载失败' })
    });
  },
  retryGroupBuy() {
    this.onLoad({ id: this.data.groupBuyId });
  },
  join() {
    const groupBuy = this.data.groupBuy;
    if (!groupBuy || !groupBuy.can_join) {
      wx.showToast({ title: groupBuy && groupBuy.is_expired ? '团购已结束' : '暂不可参团', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/join-order/index?group_buy_id=${groupBuy.group_buy_id || groupBuy.id}` });
  }
});
