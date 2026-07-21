const {
  getCartItems,
  updateCartQuantity,
  removeCartItem,
  clearCart,
  toggleCartItem,
  getSelectedCartItems,
  formatCartAmount,
} = require("../../utils/cart");

function decorate(items) {
  return items.map((item) => ({
    ...item,
    price_yuan: formatCartAmount(item.price_cents),
    subtotal_yuan: formatCartAmount(item.price_cents * item.quantity),
    spec_label: [item.sale_spec_name, item.sale_unit]
      .filter(Boolean)
      .join(" / "),
  }));
}

Page({
  data: { items: [], selectedCount: 0, selectedAmountYuan: "0.00" },
  onShow() {
    this.loadCart();
  },
  loadCart() {
    const items = decorate(getCartItems());
    const selected = getSelectedCartItems();
    this.setData({
      items,
      selectedCount: selected.reduce((sum, item) => sum + item.quantity, 0),
      selectedAmountYuan: formatCartAmount(
        selected.reduce(
          (sum, item) => sum + item.price_cents * item.quantity,
          0,
        ),
      ),
    });
  },
  increase(event) {
    updateCartQuantity(
      event.currentTarget.dataset.id,
      Number(event.currentTarget.dataset.quantity) + 1,
    );
    this.loadCart();
  },
  decrease(event) {
    updateCartQuantity(
      event.currentTarget.dataset.id,
      Math.max(1, Number(event.currentTarget.dataset.quantity) - 1),
    );
    this.loadCart();
  },
  onQuantityInput(event) {
    updateCartQuantity(event.currentTarget.dataset.id, event.detail.value);
    this.loadCart();
  },
  removeItem(event) {
    removeCartItem(event.currentTarget.dataset.id);
    this.loadCart();
  },
  toggleItem(event) {
    const id = event.currentTarget.dataset.id;
    const item = this.data.items.find((entry) => entry.product_id === id);
    toggleCartItem(id, !(item && item.selected));
    this.loadCart();
  },
  clearAll() {
    clearCart();
    this.loadCart();
  },
  goProducts() {
    wx.navigateTo({ url: "/pages/products/index" });
  },
  checkout() {
    const selected = getSelectedCartItems();
    if (!selected.length) {
      wx.showToast({ title: "请选择商品", icon: "none" });
      return;
    }
    if (selected.length > 1) {
      wx.showToast({ title: "当前版本请先选择一个商品结算", icon: "none" });
      return;
    }
    const item = selected[0];
    wx.navigateTo({
      url: `/pages/orders/confirm/index?type=normal&product_id=${item.product_id}&quantity=${item.quantity}&from_cart=1`,
    });
  },
});

