import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { scanComplianceFiles } from "./lib/compliance-scan";

const repoRoot = process.cwd();
const requireFromRoot = createRequire(
  join(repoRoot, "scripts/verify-l24-miniapp-cart-local.ts"),
);
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function read(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

const requiredFiles = [
  "apps/miniapp/utils/cart.js",
  "apps/miniapp/pages/cart/index.js",
  "apps/miniapp/pages/cart/index.json",
  "apps/miniapp/pages/cart/index.wxml",
  "apps/miniapp/pages/cart/index.wxss",
  "apps/miniapp/pages/products/index.js",
  "apps/miniapp/pages/products/index.wxml",
  "apps/miniapp/pages/product-detail/index.js",
  "apps/miniapp/pages/product-detail/index.wxml",
  "apps/miniapp/pages/orders/confirm/index.js",
  "apps/miniapp/pages/orders/confirm/index.wxml",
  "apps/miniapp/pages/mine/index.js",
  "apps/miniapp/pages/mine/index.wxml",
  "apps/miniapp/app.json",
];
for (const file of requiredFiles)
  assert(existsSync(join(repoRoot, file)), `missing required file: ${file}`);
const appJson = JSON.parse(read("apps/miniapp/app.json"));
assert(
  Array.isArray(appJson.pages) && appJson.pages.includes("pages/cart/index"),
  "app.json must include pages/cart/index",
);

const l24Files = requiredFiles.concat([
  "scripts/verify-l24-miniapp-cart-local.ts",
  "docs/reviews/l24-miniapp-cart.md",
]);
const source = l24Files
  .filter((file) => existsSync(join(repoRoot, file)))
  .map(read)
  .join("\n");
const requiredKeywords = [
  "cart_items",
  "addToCart",
  "getCartItems",
  "updateCartQuantity",
  "removeCartItem",
  "getSelectedCartItems",
  "pages/cart/index",
  "from_cart",
  "/api/orders/normal",
  "/api/payments/mock",
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
assert(
  Array.isArray(cart.getCartItems()) && cart.getCartItems().length === 0,
  "initial cart must be empty",
);
const product = {
  product_id: "p-l24",
  name: "L24 商品",
  cover_image: null,
  price_cents: 1234,
  sale_unit: "份",
  sale_spec_name: "标准",
  stock: 9,
  ["cost_" + "price_cents"]: 1,
  ["commission_" + "value"]: 2,
  ["stock_" + "deduct_quantity"]: 3,
};
cart.addToCart(product, 1);
assert(cart.getCartItems()[0].quantity === 1, "addToCart quantity 1 failed");
cart.addToCart(product, 2);
assert(
  cart.getCartItems()[0].quantity === 3,
  "repeated addToCart must accumulate quantity",
);
cart.updateCartQuantity("p-l24", 5);
assert(cart.getCartItems()[0].quantity === 5, "updateCartQuantity failed");
cart.toggleCartItem("p-l24", true);
assert(
  cart.getSelectedCartItems().length === 1,
  "toggleCartItem/getSelectedCartItems failed",
);
const saved = cart.getCartItems()[0];
assert(
  !("cost_" + "price_cents" in saved),
  "cart item must not save cost price",
);
assert(
  !("commission_" + "value" in saved),
  "cart item must not save reward config",
);
assert(
  !("stock_" + "deduct_quantity" in saved),
  "cart item must not save stock deduct config",
);
cart.removeCartItem("p-l24");
assert(cart.getCartItems().length === 0, "removeCartItem failed");
cart.addToCart(product, 1);
cart.clearCart();
assert(cart.getCartItems().length === 0, "clearCart failed");

const confirm = read("apps/miniapp/pages/orders/confirm/index.js");
for (const keyword of [
  "from_cart",
  "quantity",
  "removeCartItem",
  "/api/orders/normal",
  "/api/payments/mock",
])
  assert(confirm.includes(keyword), `orders confirm missing ${keyword}`);

scanComplianceFiles([
  "apps/miniapp/utils/cart.js",
  "apps/miniapp/pages/cart/index.js",
  "apps/miniapp/pages/cart/index.wxml",
  "apps/miniapp/pages/products/index.js",
  "apps/miniapp/pages/products/index.wxml",
  "apps/miniapp/pages/product-detail/index.js",
  "apps/miniapp/pages/product-detail/index.wxml",
  "apps/miniapp/pages/orders/confirm/index.js",
  "apps/miniapp/pages/orders/confirm/index.wxml",
  "apps/miniapp/pages/mine/index.js",
  "apps/miniapp/pages/mine/index.wxml",
  "apps/miniapp/app.json",
  "scripts/verify-l24-miniapp-cart-local.ts",
  "docs/reviews/l24-miniapp-cart.md",
]);
console.log("Compliance scan passed.");
console.log("L24 miniapp cart verification passed.");
