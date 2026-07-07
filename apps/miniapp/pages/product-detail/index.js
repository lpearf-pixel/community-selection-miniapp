const { request, formatYuan } = require("../../utils/api");
const { getSelectedCommunity } = require("../../utils/selection");
const { addToCart } = require("../../utils/cart");
function decorateProduct(product) {
  return {
    ...product,
    price_yuan: formatYuan(product.price_cents),
    active_group_buys: (product.active_group_buys || []).map((item) => ({
      ...item,
      price_yuan: formatYuan(item.price_cents),
    })),
  };
}
Page({
  data: { product: null, selectedCommunity: null },
  onLoad(options) {
    this.setData({ selectedCommunity: getSelectedCommunity() });
    this.loadProduct(options.id);
  },
  onShow() {
    this.setData({ selectedCommunity: getSelectedCommunity() });
  },
  loadProduct(id) {
    return request({ url: `/api/products/${id}` }).then((product) =>
      this.setData({ product: decorateProduct(product) }),
    );
  },
  addCart() {
    const p = this.data.product;
    if (!p) return;
    addToCart(p, 1);
    wx.showToast({ title: "已加入购物车", icon: "success" });
  },
  goCart() {
    wx.navigateTo({ url: "/pages/cart/index" });
  },
  goNormalBuy() {
    const p = this.data.product;
    const c = this.data.selectedCommunity;
    if (p && p.can_normal_buy)
      wx.navigateTo({
        url: `/pages/orders/confirm/index?type=normal&product_id=${p.product_id}${c ? `&community_id=${c.community_id}` : ""}`,
      });
  },
  goGroupBuy(event) {
    const communityId = event.currentTarget.dataset.communityId;
    wx.navigateTo({
      url: `/pages/orders/confirm/index?type=group_buy&group_buy_id=${event.currentTarget.dataset.id}${communityId ? `&community_id=${communityId}` : ""}`,
    });
  },
});
