const chunhuaqiushi = require('./chunhuaqiushi');

const DEFAULT_HOME_TEMPLATE_KEY = 'chunhuaqiushi';
const registry = Object.freeze({ chunhuaqiushi });

function resolveHomeTemplate(key) {
  return registry[key] || registry[DEFAULT_HOME_TEMPLATE_KEY];
}

module.exports = { DEFAULT_HOME_TEMPLATE_KEY, resolveHomeTemplate };
