const { getJSON } = require('../../utils/api');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

Page({
  data: {
    products: [],
    loading: false,
    error: '',
    empty: false
  },
  onLoad() {
    this.loadProducts();
  },
  loadProducts() {
    this.setData({ loading: true, error: '', empty: false });
    getJSON('/api/products')
      .then((data) => {
        const products = (data.items || []).map((item) => ({
          product_id: item.product_id,
          name: item.name,
          cover_image: item.cover_image,
          price_yuan: formatYuan(item.price_cents),
          sale_text: item.sale_spec_name || item.sale_unit,
          display_stock: item.display_stock,
          has_active_group_buy: item.has_active_group_buy
        }));
        this.setData({ products, empty: products.length === 0 });
      })
      .catch((error) => this.setData({ error: String(error || '商品列表加载失败') }))
      .finally(() => this.setData({ loading: false }));
  },
  goDetail(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/product-detail/index?id=${id}` });
  },
  goNormalBuy(event) {
    const { id } = event.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/orders/confirm/index?type=normal&product_id=${id}` });
  }
});
