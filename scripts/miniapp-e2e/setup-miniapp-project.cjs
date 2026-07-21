const fs = require('node:fs');
const path = require('node:path');
const { assertRealWeChatAppId } = require('./lib.cjs');

function createProjectConfig(appid) {
  return {
    description: '春华秋实社区甄选小程序本地开发配置',
    packOptions: { ignore: [] },
    setting: {
      urlCheck: false,
      es6: true,
      postcss: true,
      minified: true,
    },
    compileType: 'miniprogram',
    libVersion: '3.17.0',
    appid: assertRealWeChatAppId(appid),
    projectname: 'community-selection-miniapp',
    condition: {},
  };
}

function writeProjectConfig(options = {}) {
  const projectPath = path.resolve(options.projectPath || path.join(__dirname, '../../apps/miniapp'));
  const fileSystem = options.fileSystem || fs;
  const configPath = path.join(projectPath, 'project.config.json');
  const config = createProjectConfig(options.appid || process.env.MINIAPP_APP_ID);
  fileSystem.mkdirSync(projectPath, { recursive: true });
  fileSystem.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

if (require.main === module) {
  try {
    const configPath = writeProjectConfig({
      projectPath: process.env.MINIAPP_PROJECT_PATH,
      appid: process.env.MINIAPP_APP_ID,
    });
    process.stdout.write(`Mini Program project config written: ${configPath}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createProjectConfig, writeProjectConfig };
