const assert = require('node:assert/strict');
const test = require('node:test');

const pagePath = require.resolve('./index.js');
const configPath = require.resolve('../../../config.js');

function loadPage(remoteDemo) {
  const config = require(configPath);
  const previous = config.remoteDemo;
  let definition;
  config.remoteDemo = remoteDemo;
  global.Page = (value) => {
    definition = value;
  };
  delete require.cache[pagePath];
  try {
    require(pagePath);
  } finally {
    delete global.Page;
    config.remoteDemo = previous;
    delete require.cache[pagePath];
  }
  return definition;
}

test('shows a no-charge payment notice only in a generated remote demo build', () => {
  const demoPage = loadPage(true);
  assert.equal(demoPage.data.remote_demo, true);
  assert.equal(demoPage.data.payment_notice, '演示支付，不会真实扣款');
  assert.equal(demoPage.data.payment_submit_label, '提交并演示支付');

  const normalPage = loadPage(false);
  assert.equal(normalPage.data.remote_demo, false);
  assert.equal(normalPage.data.payment_notice, '');
  assert.equal(normalPage.data.payment_submit_label, '提交并支付');
});
