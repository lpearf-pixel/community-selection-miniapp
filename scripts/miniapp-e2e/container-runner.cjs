const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  artifactPaths,
  assertMiniappProjectConfigured,
  assertSupportedPlatform,
  composeLogsArgs,
  composePsArgs,
  composeUpArgs,
  resolveContainerConfig,
  resolveE2eConfig,
} = require('./lib.cjs');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function runDocker(args, config) {
  const result = spawnSync('docker', args, {
    cwd: config.repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Unable to run Docker: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Docker exited with status ${result.status}`);
}

function captureDocker(args, config) {
  const result = spawnSync('docker', args, {
    cwd: config.repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) return `command error: ${result.error.message}\n`;
  return [
    `exit=${result.status}`,
    result.stdout || '',
    result.stderr || '',
  ].join('\n');
}

function probeHealth(urlValue) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlValue);
    } catch (error) {
      resolve(false);
      return;
    }
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });
    request.setTimeout(2000, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForHealth(config) {
  const deadline = Date.now() + config.healthTimeoutMs;
  while (Date.now() < deadline) {
    if (await probeHealth(config.healthUrl)) return;
    await delay(500);
  }
  throw new Error(`API health check timed out: ${config.healthUrl}`);
}

function writeComposeDiagnostics(config, outputPath) {
  const sections = [
    ['docker compose ps', composePsArgs(config)],
    ['docker compose logs', composeLogsArgs(config)],
  ];
  const content = sections
    .map(([title, args]) => `## ${title}\n${captureDocker(args, config)}`)
    .join('\n\n');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${content}\n`, 'utf8');
}

async function main() {
  assertSupportedPlatform();
  const e2eConfig = resolveE2eConfig();
  assertMiniappProjectConfigured(e2eConfig.projectPath);
  const config = resolveContainerConfig();
  const artifacts = artifactPaths(process.env.MINIAPP_E2E_OUTPUT_DIR || '/tmp');

  try {
    if (!fs.existsSync(config.composeFile)) {
      throw new Error(`Docker Compose file not found: ${config.composeFile}`);
    }

    process.stdout.write(`Starting container services: ${config.services.join(', ')}\n`);
    runDocker(composeUpArgs(config), config);
    await waitForHealth(config);
    process.stdout.write(`API health check passed: ${config.healthUrl}\n`);

    const clickEnv = {
      ...process.env,
      MINIAPP_E2E_API_BASE_URL: process.env.MINIAPP_E2E_API_BASE_URL || new URL(config.healthUrl).origin,
    };
    const suiteIndex = process.argv.indexOf('--suite');
    const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : 'home';
    if (!['home', 'theme'].includes(suite)) throw new Error('Unknown Mini Program E2E suite: ' + suite);
    const smokeScript = suite === 'theme' ? 'theme-smoke.cjs' : 'home-smoke.cjs';
    const clickResult = spawnSync(process.execPath, [path.join(__dirname, smokeScript)], {
      cwd: config.repoRoot,
      env: clickEnv,
      stdio: 'inherit',
    });
    if (clickResult.error) throw new Error(`Unable to start click smoke: ${clickResult.error.message}`);
    if (clickResult.status !== 0) {
      throw new Error(`Mini Program click smoke exited with status ${clickResult.status}`);
    }

    process.stdout.write('Containerized Mini Program ' + suite + ' smoke passed.\n');
    process.stdout.write('Containers remain running; use pnpm e2e:miniapp:stop when finished.\n');
  } catch (error) {
    try {
      writeComposeDiagnostics(config, artifacts.composeLog);
      process.stderr.write(`Compose diagnostics: ${artifacts.composeLog}\n`);
    } catch (diagnosticError) {
      process.stderr.write(`Unable to collect Compose diagnostics: ${diagnosticError.message}\n`);
    }
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
