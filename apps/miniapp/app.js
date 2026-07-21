const { getCurrentUser } = require('./utils/user');
const activeTheme = require('./themes/active.generated');

App({
  globalData: {
    user: null,
    theme: activeTheme.getActiveTheme(),
  },
  onLaunch() {
    this.globalData.user = getCurrentUser();
  },
});
