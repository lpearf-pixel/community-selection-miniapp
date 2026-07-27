const activeTheme = require('./themes/active.generated');

const config = {
  apiBaseUrl: '',
  homeTemplateKey: activeTheme.id,
  themeId: activeTheme.id,
};

module.exports = config;
