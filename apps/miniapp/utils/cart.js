const CART_STORAGE_KEY = "cart_items";

function nowIso() {
  return new Date().toISOString();
}
function toPositiveQuantity(quantity) {
  const value = Number(quantity);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}
function productIdOf(item) {
  return String(item.product_id || item.id || "");
}
function normalizeCartItem(item) {
  const product_id = productIdOf(item);
  const quantity = toPositiveQuantity(item.quantity);
  const added_at = item.added_at || nowIso();
  return {
    product_id,
    name: String(item.name || ""),
    cover_image: item.cover_image || null,
    price_cents: Number(item.price_cents) || 0,
    sale_unit: item.sale_unit || item.unit || null,
    sale_spec_name: item.sale_spec_name || null,
    stock: typeof item.stock === "number" ? item.stock : undefined,
    quantity,
    selected: Boolean(item.selected),
    added_at,
    updated_at: item.updated_at || added_at,
  };
}
function getCartItems() {
  const items = wx.getStorageSync(CART_STORAGE_KEY);
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeCartItem)
    .filter((item) => item.product_id && item.name);
}
function saveCartItems(items) {
  wx.setStorageSync(
    CART_STORAGE_KEY,
    (Array.isArray(items) ? items : []).map(normalizeCartItem),
  );
}
function addToCart(product, quantity = 1) {
  if (typeof product.stock === "number" && product.stock <= 0)
    throw new Error("商品库存不足");
  const product_id = productIdOf(product);
  if (!product_id) throw new Error("缺少商品 ID");
  const items = getCartItems();
  const index = items.findIndex((item) => item.product_id === product_id);
  const increment = toPositiveQuantity(quantity);
  const timestamp = nowIso();
  if (index >= 0) {
    items[index] = normalizeCartItem({
      ...items[index],
      quantity: items[index].quantity + increment,
      updated_at: timestamp,
    });
  } else {
    items.push(
      normalizeCartItem({
        ...product,
        product_id,
        quantity: increment,
        selected: false,
        added_at: timestamp,
        updated_at: timestamp,
      }),
    );
  }
  saveCartItems(items);
  return items;
}
function updateCartQuantity(productId, quantity) {
  const id = String(productId || "");
  const items = getCartItems().map((item) =>
    item.product_id === id
      ? normalizeCartItem({
          ...item,
          quantity: toPositiveQuantity(quantity),
          updated_at: nowIso(),
        })
      : item,
  );
  saveCartItems(items);
  return items;
}
function removeCartItem(productId) {
  const id = String(productId || "");
  const items = getCartItems().filter((item) => item.product_id !== id);
  saveCartItems(items);
  return items;
}
function clearCart() {
  wx.removeStorageSync(CART_STORAGE_KEY);
}
function toggleCartItem(productId, selected) {
  const id = String(productId || "");
  const items = getCartItems().map((item) =>
    item.product_id === id
      ? normalizeCartItem({
          ...item,
          selected: Boolean(selected),
          updated_at: nowIso(),
        })
      : item,
  );
  saveCartItems(items);
  return items;
}
function getCartCount() {
  return getCartItems().reduce((sum, item) => sum + item.quantity, 0);
}
function getSelectedCartItems() {
  return getCartItems().filter((item) => item.selected);
}
function formatCartAmount(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

module.exports = {
  CART_STORAGE_KEY,
  getCartItems,
  saveCartItems,
  addToCart,
  updateCartQuantity,
  removeCartItem,
  clearCart,
  toggleCartItem,
  getCartCount,
  getSelectedCartItems,
  formatCartAmount,
  normalizeCartItem,
};
