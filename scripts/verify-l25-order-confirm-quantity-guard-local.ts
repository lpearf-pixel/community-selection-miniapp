import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { scanComplianceFiles } from "./lib/compliance-scan";

const repoRoot = process.cwd();
const requireFromRoot = createRequire(join(repoRoot, "package.json"));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

const requiredFiles = [
  "apps/miniapp/pages/orders/confirm/index.js",
  "apps/miniapp/pages/orders/confirm/index.wxml",
  "apps/miniapp/pages/product-detail/index.js",
  "apps/miniapp/pages/product-detail/index.wxml",
  "apps/miniapp/pages/products/index.js",
  "apps/miniapp/pages/products/index.wxml",
  "apps/miniapp/utils/cart.js",
  "scripts/verify-l25-order-confirm-quantity-guard-local.ts",
  "docs/reviews/l25-order-confirm-quantity-guard.md",
];
for (const file of requiredFiles)
  assert(existsSync(join(repoRoot, file)), `missing required file: ${file}`);

const source = requiredFiles.map(read).join("\n");
const requiredKeywords = [
  "normalizeQuantity",
  "increaseQuantity",
  "decreaseQuantity",
  "onQuantityInput",
  "subtotal_cents",
  "pay_amount_cents",
  "subtotal_yuan",
  "pay_amount_yuan",
  "stock_label",
  "can_submit",
  "from_cart",
  "removeCartItem",
  "/api/orders/normal",
  "/api/payments/mock",
  "请选择自提点",
  "商品库存不足",
];
for (const keyword of requiredKeywords)
  assert(source.includes(keyword), `missing keyword: ${keyword}`);

const forbiddenKeywords = [
  "wx.request" + "Payment",
  "/api/payments/" + "wechat",
  "wx." + "login",
  "wx.get" + "Location",
  "cost_" + "price_cents",
  "commission_" + "value",
  "commission_" + "type",
  "stock_" + "deduct_quantity",
  "parent_" + "leader_id",
  "up" + "line_id",
  "down" + "line",
  "team_" + "id",
  "AUTO_PAYOUT_ENABLED = " + "true",
  "AUTO_TAX_FILING_ENABLED = " + "true",
];
for (const keyword of forbiddenKeywords)
  assert(!source.includes(keyword), `forbidden keyword found: ${keyword}`);

const confirm = read("apps/miniapp/pages/orders/confirm/index.js");
assert(confirm.includes("this.updateQuantity(this.data.quantity"), "product load must normalize quantity after stock is known");
assert(confirm.includes("stock <= 0") && confirm.includes("商品库存不足"), "confirm page must guard stock <= 0");
assert(confirm.includes("this.data.from_cart") && confirm.includes("removeCartItem(this.data.product_id)"), "from_cart removal must remain success-only");
assert(confirm.indexOf("removeCartItem") > confirm.indexOf("createMockPayment"), "cart item must be removed only after mock payment succeeds");

const productDetail = read("apps/miniapp/pages/product-detail/index.js");
const products = read("apps/miniapp/pages/products/index.js");
assert(productDetail.includes("stock <= 0") && productDetail.includes("商品库存不足"), "product detail must block out-of-stock purchase/cart");
assert(products.includes("stock <= 0") && products.includes("商品库存不足"), "product list must block out-of-stock purchase/cart");

type WxStorage = {
  getStorageSync: (key: string) => unknown;
  setStorageSync: (key: string, value: unknown) => void;
  removeStorageSync: (key: string) => void;
};
const storage = new Map<string, unknown>();
(globalThis as unknown as { wx: WxStorage }).wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key),
};
const cart = requireFromRoot("./apps/miniapp/utils/cart.js");
assert(Array.isArray(cart.getCartItems()) && cart.getCartItems().length === 0, "initial cart must be empty");
const availableProduct = {
  product_id: "p-l25",
  name: "L25 商品",
  price_cents: 1888,
  stock: 3,
  ["cost_" + "price_cents"]: 1,
  ["commission_" + "value"]: 2,
  ["commission_" + "type"]: "fixed",
  ["stock_" + "deduct_quantity"]: 1,
  receiver_phone: "13800000000",
};
cart.addToCart(availableProduct, 1);
cart.addToCart(availableProduct, 2);
const saved = cart.getCartItems()[0];
assert(saved.quantity === 3, "repeated addToCart must accumulate quantity");
for (const field of [
  "cost_" + "price_cents",
  "commission_" + "value",
  "commission_" + "type",
  "stock_" + "deduct_quantity",
  "receiver_phone",
]) assert(!(field in saved), `cart item must not save ${field}`);
let blocked = false;
try {
  cart.addToCart({ product_id: "p-empty", name: "售罄", price_cents: 100, stock: 0 }, 1);
} catch (error) {
  blocked = error instanceof Error && error.message.includes("商品库存不足");
}
assert(blocked, "stock <= 0 product must not be added to cart");

scanComplianceFiles(requiredFiles);
console.log("Compliance scan passed.");
console.log("L25 order confirm quantity guard verification passed.");
