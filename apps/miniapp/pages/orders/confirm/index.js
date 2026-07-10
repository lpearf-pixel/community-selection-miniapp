const {
  request,
  createMockPayment,
  formatYuan,
} = require("../../../utils/api");
const { getCurrentUser } = require("../../../utils/user");
const {
  getSelectedCommunity,
  getSelectedPickupStore,
} = require("../../../utils/selection");
const { removeCartItem } = require("../../../utils/cart");
const MOCK_PAYMENT_ENDPOINT = "/api/payments/mock";
const DELIVERY_RULES_ENDPOINT_LABEL = "GET /api/delivery/rules";
function validPhone(phone) {
  return /^1\d{10}$/.test(String(phone || ""));
}
function isKnownStock(stock) {
  return typeof stock === "number" && Number.isFinite(stock);
}
Page({
  data: {
    type: "normal",
    product_id: "",
    group_buy_id: "",
    quantity: 1,
    from_cart: false,
    pickup_type: "store",
    pickup_store_id: "",
    receiver_address: "",
    community_id: "",
    receiver_name: "",
    receiver_phone: "",
    delivery_time_window_code: "",
    deliveryRule: null,
    delivery_time_windows: [],
    product: null,
    selectedCommunity: null,
    selectedPickupStore: null,
    error: "",
    loading: false,
    submitting: false,
    subtotal_cents: 0,
    subtotal_yuan: "0.00",
    pay_amount_cents: 0,
    pay_amount_yuan: "0.00",
    stock_label: "库存以门店确认为准",
    can_submit: false,
    submit_hint: "请选择自提点",
  },
  onLoad(query) {
    const user = getCurrentUser();
    this.setData({
      type: query.type === "group_buy" ? "group_buy" : "normal",
      product_id: query.product_id || "",
      group_buy_id: query.group_buy_id || "",
      quantity: this.normalizeQuantity(query.quantity),
      from_cart: query.from_cart === "1",
      community_id: query.community_id || "",
      receiver_name: user.receiver_name || user.nickname || "",
      receiver_phone: user.receiver_phone || "",
    });
    this.refreshSelection();
    this.recalculateOrderState();
    this.loadDeliveryRules();
    this.loadProduct();
  },
  onShow() {
    this.refreshSelection();
    this.loadDeliveryRules();
    this.recalculateOrderState();
  },
  refreshSelection() {
    const community = getSelectedCommunity();
    const store = getSelectedPickupStore();
    this.setData({
      selectedCommunity: community,
      selectedPickupStore: store,
      community_id:
        this.data.community_id || (community && community.community_id) || "",
      pickup_store_id:
        (store && store.pickup_store_id) || this.data.pickup_store_id || "",
    });
  },
  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  normalizeQuantity(value) {
    const parsed = Number(value);
    let next = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
    const stock = this.data && this.data.product ? this.data.product.stock : undefined;
    if (isKnownStock(stock) && stock > 0 && next > stock) next = stock;
    return next < 1 ? 1 : next;
  },
  updateQuantity(nextQuantity, options = {}) {
    const raw = Number(nextQuantity);
    const stock = this.data.product ? this.data.product.stock : undefined;
    const exceededStock = isKnownStock(stock) && stock > 0 && Number.isFinite(raw) && raw > stock;
    const quantity = this.normalizeQuantity(nextQuantity);
    this.setData({ quantity });
    this.recalculateOrderState();
    if (exceededStock && !options.silent) {
      wx.showToast({ title: "已调整为最大可购数量", icon: "none" });
    }
  },
  increaseQuantity() {
    this.updateQuantity(Number(this.data.quantity) + 1);
  },
  decreaseQuantity() {
    this.updateQuantity(Number(this.data.quantity) - 1, { silent: true });
  },
  onQuantityInput(event) {
    this.updateQuantity(event.detail.value);
  },
  chooseCommunity() {
    wx.navigateTo({ url: "/pages/communities/index" });
  },
  choosePickupStore() {
    wx.navigateTo({ url: "/pages/pickup/select/index" });
  },
  selectPickupType(event) {
    this.setData({ pickup_type: event.currentTarget.dataset.type }, () => {
      this.loadDeliveryRules();
      this.recalculateOrderState();
    });
  },
  copyPickupAddress() {
    const address = this.data.selectedPickupStore && this.data.selectedPickupStore.address;
    if (address) wx.setClipboardData({ data: address });
  },
  copyNavigationUrl() {
    const url = this.data.selectedPickupStore && this.data.selectedPickupStore.navigation_url;
    if (url) wx.setClipboardData({ data: url });
    else wx.showToast({ title: "可在高德地图搜索自提点地址", icon: "none" });
  },
  loadDeliveryRules() {
    const pickup_store_id = this.data.pickup_store_id || (this.data.selectedPickupStore && this.data.selectedPickupStore.pickup_store_id) || "";
    const query = pickup_store_id ? `?pickup_store_id=${encodeURIComponent(pickup_store_id)}` : "";
    return request({ url: `/api/delivery/rules${query}` })
      .then((rule) => {
        if (rule && rule.enabled === false && this.data.pickup_type === "delivery") {
          wx.showToast({ title: "该自提点暂不支持门店配送", icon: "none" });
          this.setData({ pickup_type: "store" });
        }
        this.setData({ deliveryRule: { ...rule, base_fee_yuan: formatYuan(rule.base_fee_cents || 0), free_threshold_yuan: rule.free_threshold_cents == null ? "" : formatYuan(rule.free_threshold_cents) }, delivery_time_windows: rule.available_time_windows || [] });
      })
      .catch(() => this.setData({ deliveryRule: null, delivery_time_windows: [] }));
  },
  selectDeliveryTimeWindow(event) {
    this.setData({ delivery_time_window_code: event.currentTarget.dataset.code });
    this.recalculateOrderState();
  },
  loadProduct() {
    if (!this.data.product_id) return Promise.resolve();
    this.setData({ loading: true });
    return request({ url: `/api/products/${this.data.product_id}` })
      .then((product) => {
        const nextProduct = {
          ...product,
          price_yuan: formatYuan(product.price_cents),
        };
        this.setData({ product: nextProduct });
        this.updateQuantity(this.data.quantity, { silent: true });
      })
      .finally(() => this.setData({ loading: false }));
  },
  recalculateOrderState() {
    const product = this.data.product;
    const price = product ? Number(product.price_cents) || 0 : 0;
    const quantity = this.normalizeQuantity(this.data.quantity);
    const stock = product ? product.stock : undefined;
    const hasStock = isKnownStock(stock);
    const stockInsufficient = hasStock && stock <= 0;
    const subtotal_cents = price * quantity;
    let stock_label = "库存以门店确认为准";
    if (hasStock) stock_label = stock > 0 ? `库存：${stock}` : "库存不足";
    let submit_hint = "";
    if (stockInsufficient) submit_hint = "商品库存不足";
    else if (!this.data.pickup_store_id) submit_hint = "请选择自提点";
    else if (this.data.pickup_type === "delivery" && !this.data.delivery_time_window_code) submit_hint = "提交校验：请选择配送时段";
    else if (this.data.pickup_type === "delivery" && (!this.data.receiver_name.trim() || !validPhone(this.data.receiver_phone) || !this.data.receiver_address.trim())) submit_hint = "提交校验：请填写完整配送信息";
    this.setData({
      quantity,
      subtotal_cents,
      subtotal_yuan: formatYuan(subtotal_cents),
      pay_amount_cents: subtotal_cents,
      pay_amount_yuan: formatYuan(subtotal_cents),
      stock_label,
      can_submit:
        Boolean(product || this.data.group_buy_id) &&
        !stockInsufficient &&
        Boolean(this.data.pickup_store_id) &&
        !this.data.submitting,
      submit_hint,
    });
  },
  validate() {
    const quantity = Number(this.data.quantity);
    const stock = this.data.product ? this.data.product.stock : undefined;
    if (isKnownStock(stock) && stock <= 0) return "商品库存不足";
    if (this.data.pickup_type === "delivery" && !this.data.delivery_time_window_code) return "提交校验：请选择配送时段";
    if (this.data.pickup_type === "delivery" && !this.data.receiver_name.trim()) return "提交校验：请填写收货人姓名";
    if (this.data.pickup_type === "delivery" && !validPhone(this.data.receiver_phone)) return "提交校验：请填写正确手机号";
    if (this.data.pickup_type === "delivery" && !this.data.receiver_address.trim()) return "提交校验：请填写收货地址";
    if (!quantity || quantity < 1) return "购买数量至少为 1";
    if (!this.data.pickup_store_id) return "请选择自提点";
    if (this.data.type === "group_buy" && !this.data.group_buy_id)
      return "缺少开团信息";
    return "";
  },
  submit() {
    if (this.data.submitting) return;
    this.recalculateOrderState();
    const error = this.validate();
    if (error) {
      this.setData({ error, submit_hint: error });
      wx.showToast({ title: error, icon: "none" });
      return;
    }
    const isGroupBuy = this.data.type === "group_buy";
    const user = getCurrentUser();
    const payload = {
      client_request_id: `miniapp-l25-${Date.now()}`,
      user_id: user.user_id || undefined,
      user_openid: user.openid,
      quantity: Number(this.data.quantity) || 1,
      pickup_type: this.data.pickup_type,
      pickup_store_id: this.data.pickup_store_id,
      community_id: this.data.community_id || undefined,
      receiver_name: this.data.receiver_name,
      receiver_phone: this.data.receiver_phone,
      receiver_address: this.data.pickup_type === "delivery" ? this.data.receiver_address : undefined,
      delivery_time_window_code: this.data.pickup_type === "delivery" ? this.data.delivery_time_window_code : undefined,
      product_id: isGroupBuy ? undefined : this.data.product_id,
      group_buy_id: isGroupBuy ? this.data.group_buy_id : undefined,
    };
    this.setData({ submitting: true, error: "", can_submit: false });
    request({
      url: isGroupBuy ? "/api/orders" : "/api/orders/normal",
      method: "POST",
      data: payload,
    })
      .then((order) => createMockPayment(order.id).then(() => order))
      .then((order) => {
        if (this.data.from_cart && this.data.product_id)
          removeCartItem(this.data.product_id);
        wx.redirectTo({ url: `/pages/orders/detail/index?id=${order.id}` });
      })
      .catch((err) => {
        const message = err.message || "下单失败";
        this.setData({ error: message, submit_hint: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ submitting: false });
        this.recalculateOrderState();
      });
  },
});
