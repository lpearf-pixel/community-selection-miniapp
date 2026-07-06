const { getJSON, postJSON } = require('../../../utils/api');
const { getMockUserIdentity } = require('../../../utils/user');

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function centsFromYuan(value) {
  return Math.round(Number(value || 0) * 100);
}

Page({
  data: {
    type: 'normal',
    product_id: '',
    group_buy_id: '',
    product: null,
    quantity: 1,
    pickup_store_id: '',
    community_id: '',
    receiver_name: '',
    receiver_phone: '',
    loading: false,
    submitting: false,
    error: '',
    empty: false
  },
  onLoad(query) {
    const type = query.type === 'group_buy' ? 'group_buy' : 'normal';
    this.setData({ type, product_id: query.product_id || '', group_buy_id: query.group_buy_id || '' });
    this.loadProduct(query.product_id || '', query.group_buy_id || '');
  },
  loadProduct(productId, groupBuyId) {
    if (!productId) {
      this.setData({ error: '缺少商品 ID', empty: true });
      return;
    }
    this.setData({ loading: true, error: '', empty: false });
    getJSON(`/api/products/${productId}`)
      .then((product) => {
        const groupBuy = (product.active_group_buys || []).find((item) => item.group_buy_id === groupBuyId);
        this.setData({
          product: {
            product_id: product.product_id,
            name: product.name,
            price_yuan: formatYuan(groupBuy ? groupBuy.price_cents : product.price_cents),
            display_stock: product.display_stock,
            sale_text: product.sale_spec_name || product.sale_unit,
            group_buy: groupBuy || null
          },
          community_id: groupBuy ? groupBuy.community_id : this.data.community_id,
          empty: !product
        });
      })
      .catch((error) => this.setData({ error: String(error || '下单信息加载失败') }))
      .finally(() => this.setData({ loading: false }));
  },
  onInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [field]: event.detail.value });
  },
  submit() {
    if (this.data.submitting) return;
    if (!this.data.receiver_name || !this.data.receiver_phone) {
      this.setData({ error: '请填写收货人和手机号' });
      return;
    }
    const isGroupBuy = this.data.type === 'group_buy';
    const path = isGroupBuy ? '/api/orders' : '/api/orders/normal';
    const identity = getMockUserIdentity();
    const payload = {
      user_id: identity.userId || undefined,
      user_openid: identity.userId ? undefined : identity.openid,
      client_request_id: `miniapp-${Date.now()}`,
      quantity: Number(this.data.quantity) || 1,
      pickup_store_id: this.data.pickup_store_id || undefined,
      community_id: this.data.community_id || undefined,
      receiver_name: this.data.receiver_name,
      receiver_phone: this.data.receiver_phone,
      product_id: isGroupBuy ? undefined : this.data.product_id,
      group_buy_id: isGroupBuy ? this.data.group_buy_id : undefined
    };
    this.setData({ submitting: true, error: '' });
    postJSON(path, payload)
      .then((order) => postJSON('/api/payments/mock', { order_id: order.id }).then(() => order))
      .then((order) => wx.redirectTo({ url: `/pages/orders/detail/index?id=${order.id}` }))
      .catch((error) => this.setData({ error: String(error || '提交订单失败') }))
      .finally(() => this.setData({ submitting: false }));
  },
  centsFromYuan
});
