import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProjectE2eConfig {
  repoRoot: string;
  apiBaseUrl: string;
  cliPath: string;
  projectPath: string;
  port: number;
  launchTimeoutMs: number;
  operationTimeoutMs: number;
  outputDir: string;
  keepData: boolean;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
}

export function resolveProjectE2eConfig(env: NodeJS.ProcessEnv = process.env): ProjectE2eConfig {
  const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const repoRoot = path.resolve(testRoot, '../../..');
  const apiBaseUrl = String(env.MINIAPP_E2E_API_BASE_URL ?? 'http://127.0.0.1:13080')
    .replace(/\/+$/, '');
  const config: ProjectE2eConfig = {
    repoRoot,
    apiBaseUrl,
    cliPath: env.WECHAT_CLI_PATH
      ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    projectPath: path.resolve(env.MINIAPP_PROJECT_PATH ?? path.join(repoRoot, 'apps/miniapp')),
    port: positiveInteger(env.MINIAPP_AUTOMATION_PORT, 9420, 'MINIAPP_AUTOMATION_PORT'),
    launchTimeoutMs: positiveInteger(
      env.MINIAPP_AUTOMATION_TIMEOUT_MS,
      60_000,
      'MINIAPP_AUTOMATION_TIMEOUT_MS',
    ),
    operationTimeoutMs: positiveInteger(
      env.MINIAPP_OPERATION_TIMEOUT_MS,
      10_000,
      'MINIAPP_OPERATION_TIMEOUT_MS',
    ),
    outputDir: env.MINIAPP_E2E_OUTPUT_DIR ?? '/tmp',
    keepData: env.MINIAPP_E2E_KEEP_DATA === 'true',
  };
  if (process.platform !== 'darwin') throw new Error('Real Mini Program E2E requires macOS');
  if (!fs.existsSync(config.cliPath)) throw new Error(`WeChat DevTools CLI not found: ${config.cliPath}`);
  if (!fs.existsSync(config.projectPath)) throw new Error(`Mini Program project not found: ${config.projectPath}`);
  return config;
}

export function makeRunId(now = new Date()): string {
  return now.toISOString().replace(/[^0-9]/g, '').slice(0, 17);
}
