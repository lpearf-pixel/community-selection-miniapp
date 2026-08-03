const activeTheme = require('./themes/active.generated');

const config = {
  apiBaseUrl: '',
  remoteDemo: false,
  firstLaunchMode: true,
  homeTemplateKey: activeTheme.id,
  themeId: activeTheme.id,
};

module.exports = config;
