const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const componentRoot = 'apps/miniapp/components/ui';
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

test('the three global UI primitives expose valid Mini Program component contracts', () => {
  for (const name of ['state-panel', 'media-thumb', 'status-pill']) {
    const base = componentRoot + '/' + name + '/index';
    for (const extension of ['js', 'json', 'wxml', 'wxss']) {
      assert.equal(existsSync(path.join(root, base + '.' + extension)), true, base + '.' + extension + ' must exist');
    }
    assert.equal(JSON.parse(read(base + '.json')).component, true);
    assert.doesNotMatch(read(base + '.wxss'), /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i);
  }
});

test('state-panel declares loading empty error states and a guarded retry event', () => {
  const source = read(componentRoot + '/state-panel/index.js');
  const markup = read(componentRoot + '/state-panel/index.wxml');
  for (const property of ['state', 'message', 'retryable']) assert.match(source, new RegExp(property + '\\s*:'));
  assert.match(source, /triggerEvent\(['"]retry['"]\)/);
  for (const state of ['loading', 'empty', 'error']) assert.match(markup, new RegExp("state === '" + state + "'"));
  assert.match(markup, /retryable/);
});

test('media-thumb keeps valid sources and switches once to the active theme fallback', () => {
  const source = read(componentRoot + '/media-thumb/index.js');
  const markup = read(componentRoot + '/media-thumb/index.wxml');
  assert.match(source, /themes\/active\.generated/);
  assert.match(source, /\/images\/products\/placeholder\.png/);
  for (const property of ['src', 'categoryIndex', 'mode']) assert.match(source, new RegExp(property + '\\s*:'));
  assert.match(markup, /binderror="onImageError"/);
  assert.match(markup, /fallbackOffset/);
});

test('status-pill accepts semantic tones without accepting arbitrary colors', () => {
  const source = read(componentRoot + '/status-pill/index.js');
  const markup = read(componentRoot + '/status-pill/index.wxml');
  for (const tone of ['brand', 'info', 'success', 'warning', 'danger', 'neutral']) assert.match(source, new RegExp("'" + tone + "'"));
  assert.match(markup, /cq-tone-{{resolvedTone}}/);
  assert.doesNotMatch(markup + source, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i);
});
