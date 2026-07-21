const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const app = JSON.parse(read('apps/miniapp/app.json'));
const { pendingRoutes } = require('./page-theme-manifest.cjs');

test('the mini program theme contract covers exactly the registered 19 pages', () => {
  assert.equal(app.pages.length, 19);
  assert.equal(new Set(app.pages).size, 19);
  assert.deepEqual(pendingRoutes, [], 'completed global themes may not retain migration exceptions');
});

test('the active theme descriptor and generated entry select chunhuaqiushi', () => {
  const descriptorPath = path.join(root, 'apps/miniapp/themes/chunhuaqiushi/theme.json');
  const activeWxssPath = path.join(root, 'apps/miniapp/styles/theme-active.generated.wxss');
  assert.equal(existsSync(descriptorPath), true, 'theme descriptor must exist');
  assert.equal(existsSync(activeWxssPath), true, 'active WXSS entry must exist');
  const activeTheme = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  const activeWxss = readFileSync(activeWxssPath, 'utf8');
  assert.equal(activeTheme.id, 'chunhuaqiushi');
  assert.match(activeWxss, /themes\/chunhuaqiushi\.wxss/);
});

test('the app stores the active data theme without calling a generated runtime getter', () => {
  const appSource = read('apps/miniapp/app.js');
  assert.match(appSource, /theme:\s*activeTheme[,\n]/);
  assert.doesNotMatch(appSource, /getActiveTheme\s*\(/);
});

test('all registered page roots opt into the global cq-page contract', () => {
  const missing = app.pages.filter((route) => !/class=["'][^"']*\bcq-page\b/.test(read('apps/miniapp/' + route + '.wxml')));
  assert.deepEqual(missing, app.pages.filter((route) => pendingRoutes.includes(route)));
});

test('batch A discovery pages use semantic roots, shared media, and shared states', () => {
  const expectations = {
    'pages/index/index': [],
    'pages/communities/index': ['state-panel'],
    'pages/pickup/select/index': ['state-panel'],
    'pages/products/index': ['state-panel', 'media-thumb'],
    'pages/product-detail/index': ['state-panel', 'media-thumb'],
    'pages/group-buys/index': ['state-panel', 'media-thumb', 'status-pill'],
    'pages/group-buy-detail/index': ['state-panel', 'media-thumb', 'status-pill'],
  };
  for (const [route, components] of Object.entries(expectations)) {
    const wxml = read('apps/miniapp/' + route + '.wxml');
    const wxss = read('apps/miniapp/' + route + '.wxss');
    const pageJson = read('apps/miniapp/' + route + '.json');
    assert.match(wxml, /class=["'][^"']*\bcq-page\b/, route + ' must use cq-page');
    assert.doesNotMatch(wxss, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i, route + ' must not hard-code visual values');
    for (const component of components) {
      assert.match(pageJson, new RegExp('"' + component + '"'), route + ' must register ' + component);
      assert.match(wxml, new RegExp('<' + component + '\\b'), route + ' must render ' + component);
    }
  }
});

test('batch B transaction pages use semantic actions, amounts, media, and statuses', () => {
  const expectations = {
    'pages/start-group-buy/index': [],
    'pages/join-order/index': [],
    'pages/cart/index': ['state-panel', 'media-thumb'],
    'pages/orders/confirm/index': ['state-panel', 'media-thumb'],
    'pages/orders/index': ['state-panel', 'media-thumb', 'status-pill'],
    'pages/orders/detail/index': ['state-panel', 'media-thumb', 'status-pill'],
    'pages/pickup/code/index': ['state-panel', 'status-pill'],
  };
  for (const [route, components] of Object.entries(expectations)) {
    const wxml = read('apps/miniapp/' + route + '.wxml');
    const wxss = read('apps/miniapp/' + route + '.wxss');
    const pageJson = read('apps/miniapp/' + route + '.json');
    assert.match(wxml, /class=["'][^"']*\bcq-page\b/, route + ' must use cq-page');
    assert.doesNotMatch(wxss, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i, route + ' must not hard-code visual values');
    assert.doesNotMatch(wxml, /type=["']primary["']/, route + ' must use semantic button classes');
    for (const component of components) {
      assert.match(pageJson, new RegExp('"' + component + '"'), route + ' must register ' + component);
      assert.match(wxml, new RegExp('<' + component + '\\b'), route + ' must render ' + component);
    }
  }
  for (const route of [
    'pages/start-group-buy/index',
    'pages/join-order/index',
    'pages/cart/index',
    'pages/orders/confirm/index',
  ]) {
    const wxml = read('apps/miniapp/' + route + '.wxml');
    assert.match(wxml, /cq-action-bar/, route + ' must use a safe-area action bar');
    assert.equal((wxml.match(/cq-button--primary/g) || []).length, 1, route + ' must expose one clear primary action');
  }
});

test('batch C account service and leader pages use semantic cards states and financial actions', () => {
  const expectations = {
    'pages/mine/index': ['state-panel', 'status-pill'],
    'pages/after-sales/apply/index': ['state-panel'],
    'pages/after-sales/detail/index': ['state-panel', 'status-pill'],
    'pages/leader/center/index': ['state-panel', 'status-pill'],
    'pages/leader/withdrawals/index': ['state-panel', 'status-pill'],
  };
  for (const [route, components] of Object.entries(expectations)) {
    const wxml = read('apps/miniapp/' + route + '.wxml');
    const wxss = read('apps/miniapp/' + route + '.wxss');
    const pageJson = read('apps/miniapp/' + route + '.json');
    assert.match(wxml, /class=["'][^"']*\bcq-page\b/, route + ' must use cq-page');
    assert.match(wxml, /cq-card/, route + ' must use themed cards');
    assert.doesNotMatch(wxss, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i, route + ' must not hard-code visual values');
    assert.doesNotMatch(wxml, /type=["']primary["']/, route + ' must use semantic button classes');
    for (const component of components) {
      assert.match(pageJson, new RegExp('"' + component + '"'), route + ' must register ' + component);
      assert.match(wxml, new RegExp('<' + component + '\\b'), route + ' must render ' + component);
    }
  }
  for (const route of ['pages/after-sales/apply/index', 'pages/leader/withdrawals/index']) {
    const wxml = read('apps/miniapp/' + route + '.wxml');
    assert.match(wxml, /cq-action-bar/, route + ' must use a safe-area action bar');
    assert.equal((wxml.match(/cq-button--primary/g) || []).length, 1, route + ' must expose one clear primary action');
  }
});
