const STORAGE_KEY = 'community_selection_user';
const DEFAULT_USER = {
  user_id: '',
  openid: 'customer-openid',
  nickname: '社区用户'
};

function getCurrentUser() {
  const stored = wx.getStorageSync(STORAGE_KEY) || {};
  return { ...DEFAULT_USER, ...stored };
}

function setCurrentUser(user) {
  const nextUser = { ...getCurrentUser(), ...(user || {}) };
  wx.setStorageSync(STORAGE_KEY, nextUser);
  return nextUser;
}

function getUserHeaders() {
  const user = getCurrentUser();
  return user.user_id ? { 'x-user-id': user.user_id } : {};
}

module.exports = { getCurrentUser, setCurrentUser, getUserHeaders };
