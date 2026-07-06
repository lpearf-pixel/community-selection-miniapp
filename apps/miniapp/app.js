const { getCurrentUser } = require('./utils/user');

App({
  globalData: {
    user: null
  },
  onLaunch() {
    this.globalData.user = getCurrentUser();
  }
});
