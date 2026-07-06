const { request, formatYuan } = require('../../utils/api');

Page({
  data: { products: [], keyword: '', loading: false },
  onLoad() { this.loadProducts(); },
  onPullDownRefresh() { this.loadProducts().finally(() => wx.stopPullDownRefresh()); },
  onKeywordInput(event) { this.setData({ keyword: event.detail.value }); },
  onSearch() { this.loadProducts(); },
  loadProducts() {
    this.setData({ loading: true });
    const keyword = this.data.keyword ? `?keyword=${encodeURIComponent(this.data.keyword)}` : '';
    return request({ url: `/api/products${keyword}` })
      .then((data) => {
        const products = (data.items || []).map((item) => ({
          ...item,
          price_yuan: formatYuan(item.price_cents),
          stock_label: item.stock > 0 ? `库存 ${item.stock}${item.unit || ''}` : '已售罄'
        }));
        this.setData({ products });
      })
      .finally(() => this.setData({ loading: false }));
  },
  goDetail(event) { wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}` }); },
  goNormalBuy(event) { wx.navigateTo({ url: `/pages/orders/confirm/index?type=normal&product_id=${event.currentTarget.dataset.id}` }); }
});
