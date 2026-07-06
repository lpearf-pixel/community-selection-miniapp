const config = require('../config');
const { getUserHeaders } = require('./user');

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:13080';

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getApiBaseUrl() {
  const storageValue = wx.getStorageSync('API_BASE_URL');
  if (storageValue) return trimTrailingSlash(storageValue);

  const app = getApp({ allowDefault: true });
  const appValue = app && app.globalData && app.globalData.apiBaseUrl;
  if (appValue) return trimTrailingSlash(appValue);

  if (config && config.apiBaseUrl) return trimTrailingSlash(config.apiBaseUrl);
  return DEFAULT_API_BASE_URL;
}

function buildQuery(params) {
  const entries = Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!entries.length) return '';
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function buildUrl(path, params) {
  const url = path.startsWith('http') ? path : `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const query = buildQuery(params);
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

function request(options) {
  const opts = options || {};
  const headers = opts.headers || opts.header || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(opts.url, opts.params),
      method: opts.method || 'GET',
      data: opts.data,
      header: { ...getUserHeaders(), ...headers },
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        const body = res.data || {};
        if (statusCode >= 400) {
          const message = body.message || `HTTP ${statusCode}`;
          wx.showToast({ title: message, icon: 'none' });
          reject(new Error(message));
          return;
        }
        if (body.success === false) {
          const message = body.message || '请求失败';
          wx.showToast({ title: message, icon: 'none' });
          reject(new Error(message));
          return;
        }
        resolve(body.data);
      },
      fail: reject
    });
  });
}

function getJSON(path, params) {
  return request({ url: path, method: 'GET', params });
}

function postJSON(path, body) {
  return request({ url: path, method: 'POST', data: body });
}

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function createMockPayment(orderId) {
  return postJSON('/api/payments/mock', { order_id: orderId });
}

module.exports = {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  request,
  getJSON,
  postJSON,
  formatYuan,
  createMockPayment
};
