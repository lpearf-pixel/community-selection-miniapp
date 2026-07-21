const config = require('../../config');
const { request } = require('../../utils/api');
const { normalizeHomeProduct, normalizeHomeGroupBuy } = require('./home-model');
const { resolveHomeTemplate } = require('./templates/index');

const routes = Object.freeze({
  products: '/pages/products/index',
  'group-buys': '/pages/group-buys/index',
  orders: '/pages/orders/index',
  'product-detail': '/pages/product-detail/index',
  'group-buy-detail': '/pages/group-buy-detail/index',
});

function listFromResponse(data) {
  if (Array.isArray(data)) return data;
  return data && Array.isArray(data.items) ? data.items : [];
}

Page({
  data: {
    layout: resolveHomeTemplate(config.homeTemplateKey),
    products: [],
    groupBuys: [],
    productsLoading: false,
    groupBuysLoading: false,
    productsError: '',
    groupBuysError: '',
  },
  onShow() {
    return this.refreshHome();
  },
  refreshHome() {
    return Promise.all([this.loadProducts(), this.loadGroupBuys()]);
  },
  loadProducts() {
    this.setData({ productsLoading: true, productsError: '' });
    return request({ url: '/api/products' })
      .then((data) => this.setData({
        products: listFromResponse(data).slice(0, 4).map(normalizeHomeProduct),
      }))
      .catch((error) => this.setData({
        productsError: error.message || '今日商品暂时加载失败',
      }))
      .finally(() => this.setData({ productsLoading: false }));
  },
  loadGroupBuys() {
    this.setData({ groupBuysLoading: true, groupBuysError: '' });
    return request({ url: '/api/group-buys' })
      .then((data) => this.setData({
        groupBuys: listFromResponse(data).slice(0, 2).map(normalizeHomeGroupBuy),
      }))
      .catch((error) => this.setData({
        groupBuysError: error.message || '邻里团购暂时加载失败',
      }))
      .finally(() => this.setData({ groupBuysLoading: false }));
  },
  onRetry(event) {
    if (event.detail.resource === 'products') return this.loadProducts();
    if (event.detail.resource === 'groupBuys') return this.loadGroupBuys();
    return Promise.resolve();
  },
  onNavigate(event) {
    const { target, id, keyword } = event.detail || {};
    let url = routes[target];
    if (!url) {
      wx.showToast({ title: '暂不可用', icon: 'none' });
      return;
    }
    if (target === 'products' && keyword) url += `?keyword=${encodeURIComponent(keyword)}`;
    if (target === 'product-detail' || target === 'group-buy-detail') {
      if (!id) {
        wx.showToast({ title: '内容暂不可用', icon: 'none' });
        return;
      }
      url += `?id=${encodeURIComponent(id)}`;
    }
    wx.navigateTo({ url });
  },
});
