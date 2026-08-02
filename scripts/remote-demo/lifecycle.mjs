import path from 'node:path';
import { normalizeQuickTunnelUrl } from './tunnel.mjs';

export const DEMO_PROJECT_NAME = 'community-selection-l58-demo';

export function createRuntimePaths(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('repoRoot must be an absolute path');
  }
  const normalizedRoot = path.resolve(repoRoot);
  const runtimeRoot = path.join(normalizedRoot, '.tmp', 'remote-demo');
  return Object.freeze({
    repoRoot: normalizedRoot,
    runtimeRoot,
    composePath: path.join(runtimeRoot, 'compose.json'),
    statePath: path.join(runtimeRoot, 'state.json'),
    miniappOutputDir: path.join(runtimeRoot, 'miniapp'),
  });
}

export function computeDeadline(startedAt, ttlMinutes) {
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    throw new Error('A valid demo start time is required');
  }
  if (
    !Number.isInteger(ttlMinutes) ||
    ttlMinutes < 30 ||
    ttlMinutes > 240
  ) {
    throw new Error('Demo TTL must be from 30 through 240 minutes');
  }
  return new Date(startedAt.getTime() + ttlMinutes * 60_000);
}

function validPid(value) {
  return Number.isInteger(value) && value > 0;
}

function validIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function stateError() {
  return new Error('Invalid L58 remote demo runtime state');
}

export function validateRuntimeState(state, paths) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw stateError();
  }
  if (
    state.version !== 1 ||
    state.projectName !== DEMO_PROJECT_NAME ||
    state.repoRoot !== paths.repoRoot ||
    state.runtimeRoot !== paths.runtimeRoot ||
    state.composePath !== paths.composePath ||
    state.miniappOutputDir !== paths.miniappOutputDir ||
    !validPid(state.orchestratorPid) ||
    !validPid(state.tunnelPid) ||
    !Number.isInteger(state.apiPort) ||
    state.apiPort < 1 ||
    state.apiPort > 65_535 ||
    !validIsoDate(state.startedAt) ||
    !validIsoDate(state.deadlineAt) ||
    Date.parse(state.deadlineAt) <= Date.parse(state.startedAt)
  ) {
    throw stateError();
  }
  try {
    if (normalizeQuickTunnelUrl(state.tunnelUrl) !== state.tunnelUrl) {
      throw stateError();
    }
  } catch {
    throw stateError();
  }
  return state;
}

export function redactText(value, secrets) {
  let result = String(value ?? '');
  const ordered = [...new Set(secrets.filter((secret) => secret))].sort(
    (left, right) => right.length - left.length,
  );
  for (const secret of ordered) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}

function safeError(error, config) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    redactText(message, [
      config.appSecret,
      config.sessionTokenSecret,
      config.adminToken,
    ]),
  );
}

function expectedTunnelCommand(command, state) {
  if (typeof command !== 'string') return false;
  return (
    /(?:^|\/)cloudflared(?:\s|$)/.test(command) &&
    /(?:^|\s)tunnel(?:\s|$)/.test(command) &&
    command.includes('--no-autoupdate') &&
    command.includes(`http://127.0.0.1:${state.apiPort}`)
  );
}

function expectedOrchestratorCommand(command, paths) {
  if (typeof command !== 'string') return false;
  const relativeEntry = /(?:^|\s)scripts\/remote-demo\/start\.mjs(?:\s|$)/;
  return (
    /(?:^|\/)node(?:\s|$)/.test(command) &&
    (command.includes(
      path.join(paths.repoRoot, 'scripts/remote-demo/start.mjs'),
    ) || relativeEntry.test(command))
  );
}

export async function cleanupRemoteDemo(state, paths, deps) {
  validateRuntimeState(state, paths);
  let processMismatch = null;
  const tunnelCommand = await deps.readProcessCommand(state.tunnelPid);
  if (tunnelCommand !== null && tunnelCommand !== undefined) {
    if (expectedTunnelCommand(tunnelCommand, state)) {
      await deps.killProcess(state.tunnelPid, 'SIGTERM');
    } else {
      processMismatch = new Error(
        `PID ${state.tunnelPid} is not the recorded cloudflared process; manual inspection required`,
      );
    }
  }

  await deps.composeDown(state);
  if (processMismatch) throw processMismatch;
  await deps.removeRuntime(state);
  return { status: 'stopped' };
}

async function rollbackStart(partial, deps) {
  let firstError = null;
  if (partial.tunnelPid) {
    try {
      const command = await deps.readProcessCommand(partial.tunnelPid);
      if (
        command &&
        expectedTunnelCommand(command, {
          apiPort: partial.apiPort,
        })
      ) {
        await deps.killProcess(partial.tunnelPid, 'SIGTERM');
      } else if (command) {
        firstError = new Error(
          `PID ${partial.tunnelPid} is not the started cloudflared process`,
        );
      }
    } catch (error) {
      firstError ??= error;
    }
  }
  if (partial.composeStarted) {
    try {
      await deps.composeDown(partial);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (!firstError) {
    try {
      await deps.removeRuntime(partial);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

export async function startRemoteDemo({ config, paths, deps }) {
  const existing = await deps.readState(paths.statePath);
  if (existing) {
    validateRuntimeState(existing, paths);
    const command = await deps.readProcessCommand(existing.orchestratorPid);
    if (expectedOrchestratorCommand(command, paths)) {
      return { status: 'already_running', state: existing };
    }
    await cleanupRemoteDemo(existing, paths, deps);
  }

  const partial = {
    projectName: DEMO_PROJECT_NAME,
    repoRoot: paths.repoRoot,
    runtimeRoot: paths.runtimeRoot,
    composePath: paths.composePath,
    miniappOutputDir: paths.miniappOutputDir,
    apiPort: config.apiPort,
    composeStarted: false,
    tunnelPid: null,
  };
  let runtimeState;
  try {
    await deps.assertPrerequisites(config, paths);
    deps.assertActive?.();
    await deps.assertPortsAvailable(config);
    deps.assertActive?.();
    await deps.prepareCompose(config, paths);
    deps.assertActive?.();
    await deps.composeUp(partial);
    partial.composeStarted = true;
    deps.assertActive?.();
    await deps.probeLocalApi(`http://127.0.0.1:${config.apiPort}`);
    deps.assertActive?.();
    const tunnel = await deps.startTunnel(
      `http://127.0.0.1:${config.apiPort}`,
    );
    partial.tunnelPid = tunnel.pid;
    deps.assertActive?.();
    const tunnelUrl = normalizeQuickTunnelUrl(tunnel.url);
    await deps.probePublicApi(tunnelUrl);
    deps.assertActive?.();
    await deps.generateCopy({ tunnelUrl, config, paths });
    deps.assertActive?.();

    const startedAt = deps.now();
    const deadlineAt = computeDeadline(startedAt, config.ttlMinutes);
    runtimeState = {
      version: 1,
      projectName: DEMO_PROJECT_NAME,
      repoRoot: paths.repoRoot,
      runtimeRoot: paths.runtimeRoot,
      composePath: paths.composePath,
      miniappOutputDir: paths.miniappOutputDir,
      apiPort: config.apiPort,
      orchestratorPid: deps.orchestratorPid,
      tunnelPid: tunnel.pid,
      tunnelUrl,
      startedAt: startedAt.toISOString(),
      deadlineAt: deadlineAt.toISOString(),
    };
    validateRuntimeState(runtimeState, paths);
    await deps.writeState(runtimeState, paths.statePath);
    await deps.printSummary(runtimeState);
    const reason = await deps.waitForShutdown(deadlineAt);
    await cleanupRemoteDemo(runtimeState, paths, deps);
    return { status: 'stopped', reason };
  } catch (error) {
    if (!runtimeState) {
      try {
        await rollbackStart(partial, deps);
      } catch (rollbackError) {
        throw safeError(rollbackError, config);
      }
    }
    throw safeError(error, config);
  }
}

export async function requestRemoteDemoStop(paths, deps) {
  const state = await deps.readState(paths.statePath);
  if (!state) return { status: 'already_stopped' };
  validateRuntimeState(state, paths);
  const command = await deps.readProcessCommand(state.orchestratorPid);
  if (command === null || command === undefined) {
    await cleanupRemoteDemo(state, paths, deps);
    return { status: 'stopped_stale_session' };
  }
  if (!expectedOrchestratorCommand(command, paths)) {
    throw new Error(
      `PID ${state.orchestratorPid} is not the L58 orchestrator; manual inspection required`,
    );
  }
  await deps.killProcess(state.orchestratorPid, 'SIGTERM');
  await deps.waitUntilStopped(paths.statePath);
  return { status: 'stop_requested' };
}
