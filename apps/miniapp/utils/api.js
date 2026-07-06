const { apiBaseUrl } = require('../config');
const { getUserHeaders } = require('./user');

function request(options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBaseUrl}${opts.url}`,
      method: opts.method || 'GET',
      data: opts.data,
      header: { ...getUserHeaders(), ...(opts.header || {}) },
      success: (res) => {
        const body = res.data || {};
        if (!body.success) {
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

function formatYuan(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function createMockPayment(orderId) {
  return request({ url: '/api/payments/mock', method: 'POST', data: { order_id: orderId } });
}

module.exports = { request, formatYuan, createMockPayment };
