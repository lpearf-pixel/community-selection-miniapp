const DEFAULT_OPENID = 'miniapp-demo-openid';

function readStorage(key) {
  try {
    return wx.getStorageSync(key);
  } catch (error) {
    return '';
  }
}

function writeStorage(key, value) {
  try {
    if (value) wx.setStorageSync(key, value);
  } catch (error) {
    // ignore storage failures in local preview
  }
}

function getMockUserIdentity() {
  const userId = readStorage('userId');
  let openid = readStorage('openid');
  if (!userId && !openid) {
    openid = DEFAULT_OPENID;
    writeStorage('openid', openid);
  }
  return { userId, openid };
}

function setMockUserIdentity(identity) {
  if (identity && identity.userId) writeStorage('userId', identity.userId);
  if (identity && identity.openid) writeStorage('openid', identity.openid);
  return getMockUserIdentity();
}

function getUserHeaders() {
  const identity = getMockUserIdentity();
  if (identity.userId) return { 'x-user-id': identity.userId };
  if (identity.openid) return { 'x-openid': identity.openid };
  return {};
}

module.exports = {
  getMockUserIdentity,
  setMockUserIdentity,
  getUserHeaders
};
