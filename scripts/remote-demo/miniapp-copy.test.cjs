const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function digestTree(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        entries.push([
          relative,
          crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
        ]);
      }
    }
  }
  visit(root);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

function createSource(root) {
  const sourceDir = path.join(root, 'miniapp-source');
  fs.mkdirSync(path.join(sourceDir, 'themes'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'config.js'),
    [
      "const activeTheme = require('./themes/active.generated');",
      '',
      'const config = {',
      "  apiBaseUrl: '',",
      '  remoteDemo: false,',
      '  firstLaunchMode: true,',
      '  homeTemplateKey: activeTheme.id,',
      '  themeId: activeTheme.id,',
      '};',
      '',
      'module.exports = config;',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(sourceDir, 'themes', 'active.generated.js'),
    "module.exports = { id: 'chunhuaqiushi' };\n",
  );
  fs.writeFileSync(path.join(sourceDir, 'app.js'), 'App({});\n');
  fs.writeFileSync(path.join(sourceDir, 'project.config.json'), '{"private":true}\n');
  fs.writeFileSync(path.join(sourceDir, 'project.private.config.json'), '{}\n');
  fs.mkdirSync(path.join(sourceDir, 'miniprogram_npm'));
  fs.writeFileSync(path.join(sourceDir, 'miniprogram_npm', 'private.js'), 'private\n');
  return sourceDir;
}

test('generates an isolated upload copy without changing the source tree', async () => {
  const { generateMiniappCopy } = await import('./miniapp-copy.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l58-miniapp-copy-'));
  const sourceDir = createSource(root);
  const outputDir = path.join(root, 'runtime', 'miniapp');
  const before = digestTree(sourceDir);
  const forbiddenValues = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];

  const result = generateMiniappCopy({
    sourceDir,
    outputDir,
    apiBaseUrl: 'https://demo-one.trycloudflare.com/',
    appId: 'wx1234567890abcdef',
    forbiddenValues,
  });

  assert.deepEqual(result, {
    outputDir,
    apiBaseUrl: 'https://demo-one.trycloudflare.com',
  });
  assert.deepEqual(digestTree(sourceDir), before);
  assert.match(
    fs.readFileSync(path.join(outputDir, 'config.js'), 'utf8'),
    /apiBaseUrl: 'https:\/\/demo-one\.trycloudflare\.com',[\s\S]*remoteDemo: true/,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(outputDir, 'project.config.json'), 'utf8')),
    {
      description: '春华秋实社区甄选小程序 L58 临时远端演示',
      packOptions: { ignore: [] },
      setting: {
        urlCheck: false,
        es6: true,
        postcss: true,
        minified: true,
      },
      compileType: 'miniprogram',
      libVersion: '3.17.0',
      appid: 'wx1234567890abcdef',
      projectname: 'community-selection-miniapp-l58-demo',
      condition: {},
    },
  );
  assert.equal(fs.existsSync(path.join(outputDir, 'project.private.config.json')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'miniprogram_npm')), false);
  const outputBytes = Buffer.concat(
    digestTree(outputDir).map(([relative]) => fs.readFileSync(path.join(outputDir, relative))),
  );
  for (const secret of forbiddenValues) {
    assert.equal(outputBytes.includes(Buffer.from(secret)), false);
  }
});

test('refuses to overwrite an existing output directory', async () => {
  const { generateMiniappCopy } = await import('./miniapp-copy.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l58-miniapp-existing-'));
  const sourceDir = createSource(root);
  const outputDir = path.join(root, 'existing');
  fs.mkdirSync(outputDir);
  fs.writeFileSync(path.join(outputDir, 'owner.txt'), 'keep me\n');

  assert.throws(
    () =>
      generateMiniappCopy({
        sourceDir,
        outputDir,
        apiBaseUrl: 'https://demo-one.trycloudflare.com',
        appId: 'wx1234567890abcdef',
        forbiddenValues: [],
      }),
    /already exists/i,
  );
  assert.equal(fs.readFileSync(path.join(outputDir, 'owner.txt'), 'utf8'), 'keep me\n');
});

test('removes an incomplete copy when a forbidden value is detected', async () => {
  const { generateMiniappCopy } = await import('./miniapp-copy.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'l58-miniapp-secret-'));
  const sourceDir = createSource(root);
  const secret = 'private-secret-that-must-not-ship';
  fs.writeFileSync(path.join(sourceDir, 'accidental.txt'), `${secret}\n`);
  const outputDir = path.join(root, 'runtime', 'miniapp');

  assert.throws(
    () =>
      generateMiniappCopy({
        sourceDir,
        outputDir,
        apiBaseUrl: 'https://demo-one.trycloudflare.com',
        appId: 'wx1234567890abcdef',
        forbiddenValues: [secret],
      }),
    /forbidden secret/i,
  );
  assert.equal(fs.existsSync(outputDir), false);
});
