const net = require('node:net');
const { spawn } = require('node:child_process');
const automator = require('miniprogram-automator');
const {
  buildDevToolsAutoArgs,
  diagnoseDevToolsLaunch,
} = require('./lib.cjs');

const MAX_CLI_OUTPUT_BYTES = 64 * 1024;
const POLL_INTERVAL_MS = 500;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isPortOpen(port, host = '127.0.0.1', timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function appendOutput(current, chunk) {
  const next = `${current}${String(chunk || '')}`;
  if (Buffer.byteLength(next) <= MAX_CLI_OUTPUT_BYTES) return next;
  return Buffer.from(next).subarray(-MAX_CLI_OUTPUT_BYTES).toString('utf8');
}

function launchError(config, cliOutput, cause) {
  const hint = diagnoseDevToolsLaunch(cliOutput);
  const error = new Error(
    `WeChat DevTools automation did not become ready on 127.0.0.1:${config.port} `
      + `within ${config.launchTimeoutMs} ms. ${hint}`,
    cause ? { cause } : undefined,
  );
  error.code = 'MINIAPP_AUTOMATION_NOT_READY';
  error.devToolsOutput = cliOutput;
  return error;
}

async function launchDevTools(config, dependencies = {}) {
  const portOpen = dependencies.isPortOpen || isPortOpen;
  const connect = dependencies.connect
    || ((endpoint) => automator.connect({ wsEndpoint: endpoint }));
  const spawnProcess = dependencies.spawnProcess || spawn;
  const wait = dependencies.delay || delay;
  const now = dependencies.now || Date.now;
  const endpoint = `ws://127.0.0.1:${config.port}`;

  if (await portOpen(config.port)) {
    try {
      return {
        miniProgram: await connect(endpoint),
        reused: true,
        cliOutput: '',
      };
    } catch (error) {
      throw launchError(config, 'The selected port is open but is not a compatible WeChat automation endpoint.', error);
    }
  }

  let cliOutput = '';
  let cliError;
  let exitCode;
  let child;
  try {
    child = spawnProcess(config.cliPath, buildDevToolsAutoArgs(config), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw launchError(config, error.message, error);
  }

  const collect = (chunk) => {
    cliOutput = appendOutput(cliOutput, chunk);
  };
  if (child.stdout) child.stdout.on('data', collect);
  if (child.stderr) child.stderr.on('data', collect);
  child.on('error', (error) => {
    cliError = error;
    collect(`\n${error.message}`);
  });
  child.on('exit', (code, signal) => {
    exitCode = code;
    if (code !== 0) collect(`\nCLI exited with code ${code}${signal ? ` (${signal})` : ''}`);
  });

  const startedAt = now();
  let lastConnectError;
  while (now() - startedAt < config.launchTimeoutMs) {
    if (await portOpen(config.port)) {
      try {
        return {
          miniProgram: await connect(endpoint),
          reused: false,
          cliOutput,
        };
      } catch (error) {
        lastConnectError = error;
      }
    }
    if (cliError || (exitCode !== undefined && exitCode !== null && exitCode !== 0)) break;
    await wait(POLL_INTERVAL_MS);
  }

  throw launchError(config, cliOutput, cliError || lastConnectError);
}

module.exports = { isPortOpen, launchDevTools };
