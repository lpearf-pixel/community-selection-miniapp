import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderDemoCompose, writeDemoCompose } from './compose.mjs';

export const DEMO_COMPOSE_PROJECT = 'community-selection-l58-demo';

function environmentValue(environment, key) {
  if (Array.isArray(environment)) {
    const prefix = `${key}=`;
    const entry = environment.find((value) => (
      typeof value === 'string' && value.startsWith(prefix)
    ));
    return entry?.slice(prefix.length);
  }
  return environment?.[key];
}

export function assertResolvedDemoTopology(model, config) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('Resolved Compose model must be an object');
  }
  const services = model.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) {
    throw new Error('Resolved Compose model must define services');
  }
  const serviceNames = Object.keys(services).sort();
  if (serviceNames.join(',') !== 'api,postgres') {
    throw new Error('Demo topology must contain exactly api and postgres');
  }
  if (Array.isArray(services.postgres.ports) && services.postgres.ports.length) {
    throw new Error('PostgreSQL must not publish a port');
  }
  if (services.postgres.ports && !Array.isArray(services.postgres.ports)) {
    throw new Error('PostgreSQL must not publish a port');
  }

  const apiPorts = services.api.ports;
  if (!Array.isArray(apiPorts) || apiPorts.length !== 1) {
    throw new Error('API must publish exactly one loopback port');
  }
  const apiPort = apiPorts[0];
  if (
    !apiPort ||
    typeof apiPort !== 'object' ||
    apiPort.host_ip !== '127.0.0.1' ||
    Number(apiPort.target) !== 13_080 ||
    Number(apiPort.published) !== config.apiPort
  ) {
    throw new Error('API must use the configured loopback-only binding');
  }

  const environment = services.api.environment;
  if (
    environmentValue(environment, 'WECHAT_PAY_MODE') !== 'mock' ||
    environmentValue(environment, 'MOCK_WECHAT_PAY') !== 'true'
  ) {
    throw new Error('API must keep mock commerce enabled');
  }
  if (environmentValue(environment, 'CURRENT_USER_MOCK_HEADERS_ENABLED') !== 'false') {
    throw new Error('API must reject external mock user headers');
  }
  if (
    environmentValue(environment, 'ADMIN_AUTH_ENABLED') !== 'true' ||
    environmentValue(environment, 'ADMIN_AUTH_MODE') !== 'token'
  ) {
    throw new Error('API must keep Admin token authentication enabled');
  }
  return model;
}

export function runDockerComposeConfig({ file, projectName, repoRoot }) {
  const result = spawnSync(
    'docker',
    ['compose', '-p', projectName, '-f', file, 'config', '--format', 'json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error) {
    throw new Error(`Docker Compose could not start: ${result.error.code || result.error.name}`);
  }
  if (result.status !== 0) {
    throw new Error(`Docker Compose rejected the demo topology (exit ${result.status})`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('Docker Compose returned invalid topology JSON');
  }
}

export async function verifyDemoTopology({
  repoRoot,
  config,
  runCompose = runDockerComposeConfig,
}) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('repoRoot must be an absolute path');
  }
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'community-selection-l58-topology-'),
  );
  fs.chmodSync(temporaryDirectory, 0o700);
  const composeFile = path.join(temporaryDirectory, 'compose.json');
  try {
    const rendered = renderDemoCompose(config, { repoRoot });
    writeDemoCompose(rendered, composeFile);
    const resolved = await runCompose({
      file: composeFile,
      projectName: DEMO_COMPOSE_PROJECT,
      repoRoot,
    });
    return assertResolvedDemoTopology(resolved, config);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const fixtureConfig = Object.freeze({
    appId: 'wx0000000000000000',
    appSecret: 'fixture-app-secret-not-used-for-login',
    sessionTokenSecret: 'fixture-session-token-secret-for-topology-only',
    adminToken: 'fixture-admin-token-secret-for-topology-only',
    apiPort: 13180,
    adminPort: 13181,
    ttlMinutes: 120,
  });
  await verifyDemoTopology({ repoRoot, config: fixtureConfig });
  process.stdout.write('L58 Docker Compose topology verified\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Topology verification failed'}\n`);
    process.exitCode = 1;
  });
}
