const { getCurrentUser } = require('./utils/user');
const activeTheme = require('./themes/active.generated');

App({
  globalData: {
    e2eContractVersion: 'miniapp-e2e-v2',
    user: null,
    theme: activeTheme,
  },
  onLaunch() {
    this.globalData.user = getCurrentUser();
  },
});
