const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

test('ships the miniapp in explicit first-launch mode', () => {
  assert.equal(config.firstLaunchMode, true);
});

test('initializes the leader center with reward and withdrawal entries hidden', () => {
  let pageDefinition;
  global.Page = (definition) => {
    pageDefinition = definition;
  };
  const pagePath = require.resolve('../pages/leader/center/index');
  delete require.cache[pagePath];
  require(pagePath);
  delete global.Page;

  assert.equal(pageDefinition.data.rewardFeaturesVisible, false);
  assert.equal(pageDefinition.data.withdrawalFeaturesVisible, false);
});

test('conditionally renders every reward and withdrawal section', () => {
  const template = fs.readFileSync(
    path.resolve(__dirname, '../pages/leader/center/index.wxml'),
    'utf8',
  );

  assert.match(template, /wx:if="{{rewardFeaturesVisible}}"/);
  assert.match(template, /wx:if="{{withdrawalFeaturesVisible}}"/);
});
