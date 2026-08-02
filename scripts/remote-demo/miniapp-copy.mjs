import fs from 'node:fs';
import path from 'node:path';
import { normalizeQuickTunnelUrl } from './tunnel.mjs';

const EXCLUDED_ROOT_ENTRIES = new Set([
  'miniprogram_npm',
  'project.config.json',
  'project.private.config.json',
]);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Mini Program ${label} marker must occur exactly once`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function projectConfig(appId) {
  return {
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
    appid: appId,
    projectname: 'community-selection-miniapp-l58-demo',
    condition: {},
  };
}

function scanOutput(directory, forbiddenValues) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const stats = fs.lstatSync(absolute);
    if (stats.isSymbolicLink()) {
      throw new Error('Generated Mini Program copy must not contain symlinks');
    }
    if (entry.isDirectory()) {
      scanOutput(absolute, forbiddenValues);
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = fs.readFileSync(absolute);
    for (const secret of forbiddenValues) {
      if (secret && bytes.includes(Buffer.from(secret))) {
        throw new Error('Generated Mini Program copy contains a forbidden secret');
      }
    }
  }
}

export function generateMiniappCopy({
  sourceDir,
  outputDir,
  apiBaseUrl,
  appId,
  forbiddenValues = [],
}) {
  if (!path.isAbsolute(sourceDir) || !path.isAbsolute(outputDir)) {
    throw new Error('Mini Program source and output paths must be absolute');
  }
  if (isWithin(sourceDir, outputDir) || isWithin(outputDir, sourceDir)) {
    throw new Error('Mini Program output must be isolated from the source tree');
  }
  if (!fs.statSync(sourceDir).isDirectory()) {
    throw new Error('Mini Program source directory is missing');
  }
  if (fs.existsSync(outputDir)) {
    throw new Error('Mini Program output directory already exists');
  }
  if (!/^wx[A-Za-z0-9]{16}$/.test(appId)) {
    throw new Error('A real Mini Program AppID is required');
  }
  const normalizedApiBaseUrl = normalizeQuickTunnelUrl(apiBaseUrl);

  try {
    fs.mkdirSync(path.dirname(outputDir), { recursive: true, mode: 0o700 });
    fs.cpSync(sourceDir, outputDir, {
      recursive: true,
      filter(sourcePath) {
        const relative = path.relative(sourceDir, sourcePath);
        if (!relative) return true;
        return !EXCLUDED_ROOT_ENTRIES.has(relative.split(path.sep)[0]);
      },
    });

    const configPath = path.join(outputDir, 'config.js');
    let configSource = fs.readFileSync(configPath, 'utf8');
    configSource = replaceExactlyOnce(
      configSource,
      "  apiBaseUrl: '',",
      `  apiBaseUrl: '${normalizedApiBaseUrl}',`,
      'apiBaseUrl',
    );
    configSource = replaceExactlyOnce(
      configSource,
      '  remoteDemo: false,',
      '  remoteDemo: true,',
      'remoteDemo',
    );
    fs.writeFileSync(configPath, configSource, 'utf8');
    fs.writeFileSync(
      path.join(outputDir, 'project.config.json'),
      `${JSON.stringify(projectConfig(appId), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    scanOutput(outputDir, forbiddenValues);
  } catch (error) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }

  return { outputDir, apiBaseUrl: normalizedApiBaseUrl };
}
