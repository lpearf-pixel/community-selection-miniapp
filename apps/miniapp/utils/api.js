const config = require('../config');
const {
  clearSession,
  ensureSession,
  getAuthorizationHeader,
} = require('./session');

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

  const selected = config && config.apiBaseUrl
    ? trimTrailingSlash(config.apiBaseUrl)
    : DEFAULT_API_BASE_URL;
  const accountInfo =
    typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null;
  const envVersion =
    accountInfo &&
    accountInfo.miniProgram &&
    accountInfo.miniProgram.envVersion;
  if (
    envVersion === 'release' &&
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/.test(selected)
  ) {
    throw new Error('正式版 API 地址不能使用 localhost');
  }
  return selected;
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

function apiError(message, statusCode, body) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.responseData = body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : null;
  return error;
}

function dispatchRequest(options, retried) {
  const opts = options || {};
  const headers = opts.headers || opts.header || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(opts.url, opts.params),
      method: opts.method || 'GET',
      data: opts.data,
      header: { ...getAuthorizationHeader(), ...headers },
      success: (res) => {
        const statusCode = Number(res.statusCode || 0);
        const body = res.data || {};
        if (statusCode === 401 && !retried) {
          clearSession();
          ensureSession(getApiBaseUrl())
            .then(() => dispatchRequest(opts, true))
            .then(resolve, reject);
          return;
        }
        if (statusCode >= 400) {
          const message = body.message || `HTTP ${statusCode}`;
          wx.showToast({ title: message, icon: 'none' });
          reject(apiError(message, statusCode, body));
          return;
        }
        if (body.success === false) {
          const message = body.message || '请求失败';
          wx.showToast({ title: message, icon: 'none' });
          reject(apiError(message, statusCode, body));
          return;
        }
        resolve(body.data);
      },
      fail: (error) => reject(apiError(error.errMsg || '网络请求失败', 0, null))
    });
  });
}

function request(options) {
  const opts = options || {};
  if (opts.skipAuth === true) return dispatchRequest(opts, false);
  return ensureSession(getApiBaseUrl()).then(() =>
    dispatchRequest(opts, false),
  );
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
