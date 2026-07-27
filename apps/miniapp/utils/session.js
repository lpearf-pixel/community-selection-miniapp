const STORAGE_KEY = 'community_selection_session';
let loginPromise = null;

function getSession() {
  return wx.getStorageSync(STORAGE_KEY) || {};
}

function getSessionToken() {
  const token = getSession().token;
  return typeof token === 'string' && token ? token : '';
}

function getAuthorizationHeader() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function clearSession() {
  wx.removeStorageSync(STORAGE_KEY);
}

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result.code
        ? resolve(result.code)
        : reject(new Error('微信登录未返回 code')),
      fail: (error) => reject(new Error(error.errMsg || '微信登录失败')),
    });
  });
}

function exchangeCode(apiBaseUrl, code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBaseUrl}/api/auth/wechat/login`,
      method: 'POST',
      data: { code },
      success: (response) => {
        const body = response.data || {};
        if (
          Number(response.statusCode) >= 400 ||
          body.success === false ||
          !body.data ||
          !body.data.token
        ) {
          reject(new Error(body.message || '微信登录失败'));
          return;
        }
        wx.setStorageSync(STORAGE_KEY, {
          token: body.data.token,
          expires_at: body.data.expires_at,
          user: body.data.user,
        });
        resolve(body.data.token);
      },
      fail: (error) => reject(new Error(error.errMsg || '微信登录请求失败')),
    });
  });
}

function ensureSession(apiBaseUrl) {
  const existing = getSessionToken();
  if (existing) return Promise.resolve(existing);
  if (!loginPromise) {
    loginPromise = wxLogin()
      .then((code) => exchangeCode(apiBaseUrl, code))
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

module.exports = {
  STORAGE_KEY,
  getSession,
  getSessionToken,
  getAuthorizationHeader,
  clearSession,
  ensureSession,
};
