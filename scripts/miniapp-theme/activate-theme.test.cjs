const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { activateTheme, checkTheme } = require('./activate-theme.cjs');

function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'miniapp-theme-'));
  const miniapp = path.join(root, 'apps/miniapp');
  mkdirSync(path.join(miniapp, 'themes/chunhuaqiushi'), { recursive: true });
  mkdirSync(path.join(miniapp, 'styles/themes'), { recursive: true });
  writeFileSync(path.join(miniapp, 'themes/chunhuaqiushi/theme.json'), JSON.stringify({
    id: 'chunhuaqiushi',
    navigation: {
      title: '春华秋实',
      backgroundColor: '#FAF7EE',
      textStyle: 'black',
    },
  }, null, 2));
  writeFileSync(path.join(miniapp, 'themes/chunhuaqiushi/theme.js'), 'module.exports = Object.freeze({ id: "chunhuaqiushi" });\n');
  writeFileSync(path.join(miniapp, 'styles/themes/chunhuaqiushi.wxss'), 'page {}\n');
  writeFileSync(path.join(miniapp, 'app.json'), JSON.stringify({
    pages: ['pages/index/index'],
    window: { navigationBarTitleText: '旧标题' },
  }, null, 2));
  return root;
}

test('activates a registered theme and writes deterministic JS, WXSS, and navigation output', () => {
  const root = createFixture();
  try {
    const result = activateTheme('chunhuaqiushi', root);
    assert.equal(result.themeId, 'chunhuaqiushi');
    assert.match(result.generatedJs, /require\('\.\/chunhuaqiushi\/theme'\)/);
    assert.match(result.generatedWxss, /@import "themes\/chunhuaqiushi\.wxss";/);
    assert.equal(result.window.navigationBarBackgroundColor, '#FAF7EE');
    assert.equal(result.window.navigationBarTitleText, '春华秋实');
    assert.equal(
      readFileSync(path.join(root, 'apps/miniapp/styles/theme-active.generated.wxss'), 'utf8'),
      result.generatedWxss,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(root, 'apps/miniapp/themes/chunhuaqiushi/descriptor.generated.js'), 'utf8')
        .replace(/^'use strict';\n\nmodule\.exports = /, '')
        .replace(/;\n$/, '')),
      JSON.parse(readFileSync(path.join(root, 'apps/miniapp/themes/chunhuaqiushi/theme.json'), 'utf8')),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generates a data-only CommonJS theme entry for the Mini Program runtime', () => {
  const root = createFixture();
  try {
    const result = activateTheme('chunhuaqiushi', root);
    assert.equal(
      result.generatedJs,
      "'use strict';\n\nmodule.exports = require('./chunhuaqiushi/theme');\n",
    );
    assert.doesNotMatch(result.generatedJs, /Object\.freeze|getActiveTheme|\.\.\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('generates a JavaScript descriptor so the Mini Program runtime never requires JSON', () => {
  const root = createFixture();
  try {
    const result = activateTheme('chunhuaqiushi', root);
    assert.match(result.generatedDescriptorJs, /^'use strict';\n\nmodule\.exports = \{/);
    assert.doesNotMatch(result.generatedDescriptorJs, /require\s*\([^)]*\.json/);
    assert.doesNotMatch(
      readFileSync(path.join(root, 'apps/miniapp/themes/chunhuaqiushi/theme.js'), 'utf8'),
      /require\s*\([^)]*\.json/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects an unregistered theme without changing the active files', () => {
  const root = createFixture();
  try {
    assert.throws(() => activateTheme('missing-theme', root), /Unknown miniapp theme/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check mode detects committed generated theme drift without rewriting files', () => {
  const root = createFixture();
  try {
    activateTheme('chunhuaqiushi', root);
    assert.doesNotThrow(() => checkTheme('chunhuaqiushi', root));
    const generatedPath = path.join(root, 'apps/miniapp/themes/active.generated.js');
    writeFileSync(generatedPath, 'module.exports = {};\n');
    assert.throws(() => checkTheme('chunhuaqiushi', root), /Theme activation drift.*active\.generated\.js/);
    assert.equal(readFileSync(generatedPath, 'utf8'), 'module.exports = {};\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('check mode detects generated JavaScript descriptor drift', () => {
  const root = createFixture();
  try {
    activateTheme('chunhuaqiushi', root);
    const generatedPath = path.join(root, 'apps/miniapp/themes/chunhuaqiushi/descriptor.generated.js');
    writeFileSync(generatedPath, 'module.exports = {};\n');
    assert.throws(() => checkTheme('chunhuaqiushi', root), /Theme activation drift.*descriptor\.generated\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
