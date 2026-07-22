const activeTheme = require('../../../themes/active.generated');

const DEFAULT_HOME_TEMPLATE_KEY = activeTheme.id;
const registry = Object.freeze({ [activeTheme.id]: activeTheme });

function resolveHomeTemplate(key) {
  return registry[key] || activeTheme;
}

module.exports = { DEFAULT_HOME_TEMPLATE_KEY, resolveHomeTemplate };
