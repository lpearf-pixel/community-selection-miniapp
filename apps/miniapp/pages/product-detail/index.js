const { getJSON } = require('../../utils/api');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function decorateProduct(product) {
  return {
    product_id: product.product_id,
    name: product.name,
    cover_image: product.cover_image,
    description: product.description,
    price_yuan: formatYuan(product.price_cents),
    display_stock: product.display_stock,
    sale_text: product.sale_spec_name || product.sale_unit,
    can_normal_buy: product.can_normal_buy,
    active_group_buys: (product.active_group_buys || []).map((item) => ({
      ...item,
      price_yuan: formatYuan(item.price_cents)
    }))
  };
}

Page({
  data: {
    productId: '',
    product: null,
    loading: false,
    error: '',
    empty: false
  },
  onLoad(options) {
    this.setData({ productId: options.id || '' });
    this.loadProduct(options.id);
  },
  loadProduct(productId) {
    if (!productId) {
      this.setData({ error: '缺少商品 ID', empty: true });
      return;
    }
    this.setData({ loading: true, error: '', empty: false });
    getJSON(`/api/products/${productId}`)
      .then((product) => this.setData({ product: decorateProduct(product), empty: !product }))
      .catch((error) => this.setData({ error: String(error || '商品详情加载失败') }))
      .finally(() => this.setData({ loading: false }));
  },
  goNormalBuy() {
    const product = this.data.product;
    if (!product || !product.can_normal_buy) return;
    wx.navigateTo({ url: `/pages/orders/confirm/index?type=normal&product_id=${product.product_id}` });
  },
  goGroupBuy(event) {
    const { id } = event.currentTarget.dataset;
    const product = this.data.product;
    if (!id || !product) return;
    wx.navigateTo({ url: `/pages/orders/confirm/index?type=group_buy&group_buy_id=${id}&product_id=${product.product_id}` });
  }
});
