const { request, formatYuan } = require('../../utils/api');
const { getSelectedCommunity } = require('../../utils/selection');

Page({
  data: { products: [], keyword: '', loading: false, selectedCommunity: null },
  onLoad() { this.refreshSelection(); this.loadProducts(); },
  onShow() { this.refreshSelection(); },
  onPullDownRefresh() { this.loadProducts().finally(() => wx.stopPullDownRefresh()); },
  refreshSelection() { this.setData({ selectedCommunity: getSelectedCommunity() }); },
  onKeywordInput(event) { this.setData({ keyword: event.detail.value }); },
  onSearch() { this.loadProducts(); },
  loadProducts() {
    this.setData({ loading: true });
    return request({ url: '/api/products', params: { keyword: this.data.keyword } })
      .then((data) => this.setData({ products: (data.items || []).map((item) => ({ ...item, price_yuan: formatYuan(item.price_cents), stock_label: item.stock > 0 ? `库存 ${item.stock}${item.unit || ''}` : '已售罄' })) }))
      .finally(() => this.setData({ loading: false }));
  },
  chooseCommunity() { wx.navigateTo({ url: '/pages/communities/index' }); },
  goDetail(event) { wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` }); },
  goNormalBuy(event) { const c = this.data.selectedCommunity; wx.navigateTo({ url: `/pages/orders/confirm/index?type=normal&product_id=${event.currentTarget.dataset.id}${c ? `&community_id=${c.community_id}` : ''}` }); }
});
