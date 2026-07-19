import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import {
  L48_RUNTIME_MARKERS,
} from './l48-security-privacy-contract.ts';

const repoRoot = process.cwd();
const unknownErrorMarker = 'l48_unknown_error_sanitized=true';
const httpLogMarkerEvidence = 'l48_http_log_privacy_verified=true';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function noProxyValue(): string {
  return ['localhost', '127.0.0.1', '::1']
    .concat(
      String(process.env.NO_PROXY ?? process.env.no_proxy ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .filter((value, index, items) => items.indexOf(value) === index)
    .join(',');
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate an isolated API port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function runFocusedTests(): Promise<void> {
  const testFiles = [
    'src/modules/current-user/current-user-security.test.ts',
    'src/routes/current-user-route.test.ts',
    'src/modules/me-center/me-center-routes.test.ts',
    'src/routes/me/orders-security.test.ts',
    'src/routes/leader-withdrawals-security.test.ts',
    'src/routes/leader-reward-conversion-security.test.ts',
    'src/services/http-log-privacy.test.ts',
    'src/services/logging-service-privacy.test.ts',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      [
        '--filter',
        '@community-selection/api',
        'exec',
        'vitest',
        'run',
        ...testFiles,
      ],
      {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...process.env,
          NO_PROXY: noProxyValue(),
          no_proxy: noProxyValue(),
        },
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `L48 focused tests exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`,
        ),
      );
    });
  });
}

function startApiServer(port: number): {
  child: ChildProcessWithoutNullStreams;
  logs: { value: string };
} {
  const logs = { value: '' };
  const child = spawn(
    'pnpm',
    ['exec', 'tsx', 'apps/api/src/server.ts'],
    {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        MOCK_WECHAT_PAY: 'true',
        WECHAT_PAY_MODE: 'mock',
        ADMIN_AUTH_ENABLED: 'false',
        AUTO_PAYOUT_ENABLED: 'false',
        AUTO_TAX_FILING_ENABLED: 'false',
        NO_PROXY: noProxyValue(),
        no_proxy: noProxyValue(),
      },
    },
  );
  child.stdout.on('data', (chunk: Buffer | string) => {
    logs.value += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer | string) => {
    logs.value += chunk.toString();
  });
  return { child, logs };
}

function runScenario(
  apiBaseUrl: string,
  runToken: string,
  requestMarker: string,
  requestPhone: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/verify-l48-security-privacy-docker-e2e-local.ts',
      ],
      {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          API_BASE_URL: apiBaseUrl,
          L48_RUN_TOKEN: runToken,
          L48_HTTP_LOG_MARKER: requestMarker,
          L48_HTTP_LOG_PHONE: requestPhone,
          NO_PROXY: noProxyValue(),
          no_proxy: noProxyValue(),
        },
      },
    );
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const diagnostic = `${stdout}\n${stderr}`.trim().slice(-4000);
      reject(
        new Error(
          `L48 isolated scenario exited with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}${diagnostic ? `\n${diagnostic}` : ''}`,
        ),
      );
    });
  });
}

function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      finish();
    });
    child.kill('SIGTERM');
  });
}

function verifyHttpLogs(logs: string, requestMarker: string, requestPhone: string) {
  assert(logs.length > 0, 'L48 API produced no logs to inspect');
  assert(
    logs.includes('"path":"/api/me/orders"'),
    'L48 HTTP logs do not contain the sanitized request path',
  );
  assert(
    logs.includes('"status_code":'),
    'L48 HTTP logs do not contain the sanitized response status code',
  );

  for (const secret of [
    requestMarker,
    requestPhone,
    '?user_id=',
    'authorization',
    'x-user-id',
    'x-openid',
    'x-admin-token',
    'receiver_address',
    'receiver_phone',
    'session=',
  ]) {
    assert(!logs.includes(secret), `L48 HTTP logs exposed forbidden token: ${secret}`);
  }
}

function occurrenceCount(text: string, token: string): number {
  return text.split(token).length - 1;
}

async function main(): Promise<void> {
  assert(
    process.env.DATABASE_URL,
    'DATABASE_URL is required for the L48 isolated Docker E2E',
  );

  await runFocusedTests();

  const port = await findAvailablePort();
  const runToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const requestMarker = `l48-http-${runToken}-unique-secret`;
  const requestPhone = '13948000000';
  const api = startApiServer(port);
  let stopping = false;

  const earlyServerExit = new Promise<never>((_, reject) => {
    api.child.once('exit', (code, signal) => {
      if (stopping) return;
      reject(
        new Error(
          `L48 isolated API exited early with code ${code ?? 'null'}${signal ? ` signal ${signal}` : ''}`,
        ),
      );
    });
  });

  let scenarioOutput = '';
  try {
    scenarioOutput = await Promise.race([
      runScenario(
        `http://127.0.0.1:${port}`,
        runToken,
        requestMarker,
        requestPhone,
      ),
      earlyServerExit,
    ]);
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    stopping = true;
    await stopProcess(api.child);
  }

  verifyHttpLogs(api.logs.value, requestMarker, requestPhone);

  const finalOutput = [
    scenarioOutput.trim(),
    unknownErrorMarker,
    httpLogMarkerEvidence,
    'L48 security privacy Docker API E2E verification passed.',
  ]
    .filter(Boolean)
    .join('\n');

  for (const marker of L48_RUNTIME_MARKERS) {
    assert(
      occurrenceCount(finalOutput, marker) === 1,
      `L48 runtime marker must occur exactly once: ${marker}`,
    );
  }

  console.log(finalOutput);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
