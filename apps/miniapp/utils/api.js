const { getUserHeaders } = require('./user');

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:13080';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function getApiBaseUrl() {
  let storageBaseUrl = '';
  try {
    storageBaseUrl = wx.getStorageSync('API_BASE_URL');
  } catch (error) {
    storageBaseUrl = '';
  }
  const app = typeof getApp === 'function' ? getApp({ allowDefault: true }) : null;
  const appBaseUrl = app && app.globalData ? app.globalData.apiBaseUrl : '';
  return trimTrailingSlash(storageBaseUrl || appBaseUrl || DEFAULT_API_BASE_URL);
}

function buildUrl(path, params) {
  const base = getApiBaseUrl();
  const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
  const query = params
    ? Object.keys(params)
      .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&')
    : '';
  return `${base}${normalizedPath}${query ? `?${query}` : ''}`;
}

function request(options) {
  const method = options.method || 'GET';
  const header = Object.assign({}, getUserHeaders(), options.headers || {});
  return new Promise((resolve, reject) => {
    wx.request({
      url: buildUrl(options.url, options.params),
      method,
      data: options.data || {},
      header,
      success: (res) => {
        const body = res.data || {};
        if (res.statusCode >= 400) {
          reject(body.message || `请求失败：${res.statusCode}`);
          return;
        }
        if (body && body.success === false) {
          reject(body.message || '请求失败');
          return;
        }
        resolve(body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body);
      },
      fail: (error) => reject(error && error.errMsg ? error.errMsg : '网络请求失败')
    });
  });
}

function getJSON(path, params) {
  return request({ url: path, method: 'GET', params });
}

function postJSON(path, body) {
  return request({ url: path, method: 'POST', data: body });
}

module.exports = {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  request,
  getJSON,
  postJSON
};
