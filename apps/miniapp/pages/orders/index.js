const { request } = require('../../utils/api');
const { normalizeOrder } = require('../../utils/order');

const statusTabs = [
  { key: 'all', label: '全部' },
  { key: 'unpaid', label: '待支付' },
  { key: 'ready', label: '待自提' },
  { key: 'completed', label: '已完成' },
  { key: 'after_sale', label: '售后中' },
  { key: 'refunded', label: '已退款' }
];
const typeTabs = [
  { key: 'all', label: '全部' },
  { key: 'normal', label: '普通购买' },
  { key: 'group_buy', label: '开团订单' }
];

Page({
  data: { statusTabs, typeTabs, activeStatus: 'all', activeType: 'all', orders: [], page: 1, page_size: 20, total: 0, hasMore: true, loading: false, refreshing: false, error: '' },
  onLoad() { this.loadOrders(true); },
  onPullDownRefresh() { this.setData({ refreshing: true }); this.loadOrders(true).finally(() => { this.setData({ refreshing: false }); wx.stopPullDownRefresh(); }); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.loadOrders(false); },
  switchStatus(event) { this.setData({ activeStatus: event.currentTarget.dataset.key }); this.loadOrders(true); },
  switchType(event) { this.setData({ activeType: event.currentTarget.dataset.key }); this.loadOrders(true); },
  buildParams(page) {
    const params = { page, page_size: this.data.page_size };
    if (this.data.activeType !== 'all') params.type = this.data.activeType;
    if (this.data.activeStatus === 'unpaid') params.status = 'unpaid';
    if (this.data.activeStatus === 'ready') params.status = 'ready';
    if (this.data.activeStatus === 'completed') params.status = 'completed';
    if (this.data.activeStatus === 'refunded') params.status = 'refunded';
    return params;
  },
  loadOrders(reset) {
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '' });
    return request({ url: '/api/me/orders', params: this.buildParams(page) }).then((res) => {
      let items = (res.items || res || []).map(normalizeOrder);
      if (this.data.activeStatus === 'after_sale') items = items.filter((item) => item.has_after_sale);
      const orders = reset ? items : this.data.orders.concat(items);
      const total = Number(res.total || orders.length);
      this.setData({ orders, page, total, hasMore: orders.length < total && items.length > 0 });
    }).catch((error) => this.setData({ error: error.message || '订单加载失败' })).finally(() => this.setData({ loading: false }));
  },
  goDetail(event) { wx.navigateTo({ url: `/pages/orders/detail/index?id=${event.currentTarget.dataset.id}` }); },
  goPickupCode(event) { wx.navigateTo({ url: `/pages/pickup/code/index?id=${event.currentTarget.dataset.id}` }); },
  applyAfterSale(event) { wx.navigateTo({ url: `/pages/after-sales/apply/index?order_id=${event.currentTarget.dataset.id}` }); },
  goAfterSale(event) { wx.navigateTo({ url: `/pages/after-sales/detail/index?order_id=${event.currentTarget.dataset.id}` }); }
});
