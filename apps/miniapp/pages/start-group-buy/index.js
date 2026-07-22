const { getApiBaseUrl } = require('../../utils/api');
const { getCurrentUser } = require('../../utils/user');

function toFutureIso(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function asItems(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.items)) return value.items;
  return [];
}

function normalizeProduct(item) {
  const id = item.product_id || item.id;
  return { ...item, id, product_id: id };
}

function normalizeCommunity(item) {
  const id = item.community_id || item.id;
  return { ...item, id, community_id: id };
}

Page({
  data: {
    products: [],
    communities: [],
    productIndex: 0,
    communityIndex: 0,
    min_people: 2,
    min_quantity: 2,
    end_time: toFutureIso(24),
    pickup_time: toFutureIso(48),
    loading: false
  },
  onLoad() {
    this.loadOptions();
  },
  loadOptions() {
    const apiBaseUrl = getApiBaseUrl();
    wx.request({
      url: `${apiBaseUrl}/api/products?page_size=100`,
      success: (res) => {
        const data = res.data && res.data.data;
        const items = asItems(data)
          .filter((item) => item.is_group_enabled)
          .map(normalizeProduct);
        this.setData({ products: items });
      }
    });
    wx.request({
      url: `${apiBaseUrl}/api/communities`,
      success: (res) => {
        const data = res.data && res.data.data;
        this.setData({ communities: asItems(data).map(normalizeCommunity) });
      }
    });
  },
  onProductChange(event) {
    this.setData({ productIndex: Number(event.detail.value) });
  },
  onCommunityChange(event) {
    this.setData({ communityIndex: Number(event.detail.value) });
  },
  onMinPeopleInput(event) {
    this.setData({ min_people: Number(event.detail.value) || 2 });
  },
  onMinQuantityInput(event) {
    this.setData({ min_quantity: Number(event.detail.value) || 2 });
  },
  submit() {
    const product = this.data.products[this.data.productIndex];
    const community = this.data.communities[this.data.communityIndex];
    const user = getCurrentUser();
    if (!product || !community) {
      wx.showToast({ title: '请先选择商品和社区', icon: 'none' });
      return;
    }
    this.setData({ loading: true });
    const apiBaseUrl = getApiBaseUrl();
    wx.request({
      url: `${apiBaseUrl}/api/group-buys`,
      method: 'POST',
      data: {
        product_id: product.product_id || product.id,
        community_id: community.community_id || community.id,
        leader_openid: user.openid,
        min_people: this.data.min_people,
        min_quantity: this.data.min_quantity,
        end_time: this.data.end_time,
        pickup_time: this.data.pickup_time
      },
      success: (res) => {
        if (res.data && res.data.success) {
          wx.navigateTo({ url: `/pages/group-buy-detail/index?id=${res.data.data.id}` });
        } else {
          wx.showToast({ title: (res.data && res.data.message) || '发起失败', icon: 'none' });
        }
      },
      complete: () => this.setData({ loading: false })
    });
  }
});
