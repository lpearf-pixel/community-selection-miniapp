'use strict';

const theme = require('./chunhuaqiushi/theme');

module.exports = Object.freeze({
  ...theme,
  getActiveTheme: () => theme,
});
