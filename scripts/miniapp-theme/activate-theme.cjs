const fs = require('node:fs');
const path = require('node:path');

function writeAtomic(filePath, content, fileSystem = fs) {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = filePath + '.tmp-' + process.pid;
  fileSystem.writeFileSync(temporaryPath, content);
  fileSystem.renameSync(temporaryPath, filePath);
}

function loadRegisteredTheme(themeId, rootDir, fileSystem = fs) {
  const miniappRoot = path.join(rootDir, 'apps/miniapp');
  const themeRoot = path.join(miniappRoot, 'themes', themeId);
  const descriptorPath = path.join(themeRoot, 'theme.json');
  const modulePath = path.join(themeRoot, 'theme.js');
  const wxssPath = path.join(miniappRoot, 'styles/themes', themeId + '.wxss');
  if (!themeId || !fileSystem.existsSync(descriptorPath) || !fileSystem.existsSync(modulePath) || !fileSystem.existsSync(wxssPath)) {
    throw new Error('Unknown miniapp theme: ' + (themeId || '<empty>'));
  }
  const descriptor = JSON.parse(fileSystem.readFileSync(descriptorPath, 'utf8'));
  if (descriptor.id !== themeId || !descriptor.navigation) {
    throw new Error('Invalid miniapp theme descriptor: ' + themeId);
  }
  return { descriptor, miniappRoot };
}

function renderThemeArtifacts(themeId) {
  return {
    generatedJs: [
      "'use strict';",
      '',
      "module.exports = require('./" + themeId + "/theme');",
      '',
    ].join('\n'),
    generatedWxss: '@import "themes/' + themeId + '.wxss";\n',
  };
}

function activateTheme(themeId, rootDir = path.resolve(__dirname, '../..'), options = {}) {
  const fileSystem = options.fileSystem || fs;
  const { descriptor, miniappRoot } = loadRegisteredTheme(themeId, rootDir, fileSystem);
  const appJsonPath = path.join(miniappRoot, 'app.json');
  const app = JSON.parse(fileSystem.readFileSync(appJsonPath, 'utf8'));
  const artifacts = renderThemeArtifacts(themeId);
  const window = {
    ...(app.window || {}),
    navigationBarTitleText: descriptor.navigation.title,
    navigationBarBackgroundColor: descriptor.navigation.backgroundColor,
    navigationBarTextStyle: descriptor.navigation.textStyle,
  };
  const nextApp = { ...app, window };

  writeAtomic(path.join(miniappRoot, 'themes/active.generated.js'), artifacts.generatedJs, fileSystem);
  writeAtomic(path.join(miniappRoot, 'styles/theme-active.generated.wxss'), artifacts.generatedWxss, fileSystem);
  writeAtomic(appJsonPath, JSON.stringify(nextApp, null, 2) + '\n', fileSystem);

  return { themeId, ...artifacts, window };
}

function checkTheme(themeId, rootDir = path.resolve(__dirname, '../..'), options = {}) {
  const fileSystem = options.fileSystem || fs;
  const { descriptor, miniappRoot } = loadRegisteredTheme(themeId, rootDir, fileSystem);
  const artifacts = renderThemeArtifacts(themeId);
  const appJsonPath = path.join(miniappRoot, 'app.json');
  const app = JSON.parse(fileSystem.readFileSync(appJsonPath, 'utf8'));
  const expectedWindow = {
    navigationBarTitleText: descriptor.navigation.title,
    navigationBarBackgroundColor: descriptor.navigation.backgroundColor,
    navigationBarTextStyle: descriptor.navigation.textStyle,
  };
  const drift = [];
  const generatedFiles = [
    ['themes/active.generated.js', artifacts.generatedJs],
    ['styles/theme-active.generated.wxss', artifacts.generatedWxss],
  ];
  for (const [relativePath, expected] of generatedFiles) {
    const filePath = path.join(miniappRoot, relativePath);
    const actual = fileSystem.existsSync(filePath) ? fileSystem.readFileSync(filePath, 'utf8') : '';
    if (actual !== expected) drift.push(relativePath);
  }
  for (const [key, expected] of Object.entries(expectedWindow)) {
    if (!app.window || app.window[key] !== expected) drift.push('app.json.window.' + key);
  }
  if (drift.length) throw new Error('Theme activation drift: ' + drift.join(', '));
  return { themeId, files: 3 };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    const result = checkTheme(args[1]);
    process.stdout.write('miniapp_theme=' + result.themeId + '\nminiapp_theme_check=clean\n');
  } else {
    const result = activateTheme(args[0]);
    process.stdout.write('miniapp_theme=' + result.themeId + '\nminiapp_theme_files=3\n');
  }
}

module.exports = { activateTheme, checkTheme, loadRegisteredTheme, renderThemeArtifacts };
