const activeTheme = require('./themes/active.generated');

const config = {
  apiBaseUrl: 'http://localhost:13080',
  homeTemplateKey: activeTheme.id,
  themeId: activeTheme.id,
};

module.exports = config;
