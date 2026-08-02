import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadDemoConfig } from './config.mjs';
import {
  createRuntimePaths,
  validateRuntimeState,
} from './lifecycle.mjs';
import { probeDemoApi, readStateFile } from './start.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '../..');
const INHERITED_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'NODE_OPTIONS',
];

export function buildAdminProcessSpec(config, state, baseEnv = process.env) {
  if (config.apiPort !== state.apiPort) {
    throw new Error('Configured API port does not match the running demo');
  }
  const inherited = {};
  for (const key of INHERITED_ENV_KEYS) {
    if (typeof baseEnv[key] === 'string') inherited[key] = baseEnv[key];
  }
  return {
    command: 'pnpm',
    args: [
      '--filter',
      '@community-selection/admin',
      'exec',
      'vite',
      '--host',
      '127.0.0.1',
      '--port',
      String(config.adminPort),
    ],
    env: {
      ...inherited,
      NODE_ENV: 'development',
      VITE_API_BASE_URL: `http://127.0.0.1:${state.apiPort}`,
      VITE_ADMIN_TOKEN: config.adminToken,
    },
    options: {
      shell: false,
      stdio: 'inherit',
    },
  };
}

function runAdmin(spec, repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      ...spec.options,
      cwd: repoRoot,
      env: spec.env,
    });
    child.once('error', () => reject(new Error('Unable to start local Admin')));
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolve();
      } else {
        reject(new Error(`Local Admin exited with status ${code}`));
      }
    });
  });
}

export async function main(repoRoot = defaultRepoRoot) {
  const paths = createRuntimePaths(repoRoot);
  const config = loadDemoConfig({ repoRoot: paths.repoRoot });
  const state = readStateFile(paths.statePath);
  if (!state) {
    throw new Error('L58 remote demo is not running');
  }
  validateRuntimeState(state, paths);
  await probeDemoApi(`http://127.0.0.1:${state.apiPort}`, {
    timeoutMs: 10_000,
  });
  const spec = buildAdminProcessSpec(config, state);
  process.stdout.write(
    `Local L58 Admin: http://127.0.0.1:${config.adminPort}\n`,
  );
  await runAdmin(spec, paths.repoRoot);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
